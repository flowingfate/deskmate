/**
 * MCP client manager(单例)。
 *
 * 责任:
 *   - 维护 `serverName -> McpClient` 实例;
 *   - 通过 `RuntimeStateStore` 对外暴露运行时状态(status / tools / lastError)
 *     并做 debounce IPC 推送;
 *   - 通过 `OperationLockRegistry` 保证同 server 上 connect / disconnect /
 *     reconnect 三种操作互斥;
 *   - 生命周期编排(初始化 → 按 in_use 起连接;profile 切换 → ghost sweep;
 *     进程退出 → 全量 cleanup 并回收挂死子进程);
 *   - Server 增删改的对外入口;
 *   - `executeToolOnServer` 的最终派发。
 *
 * **执行入口只有 `executeToolOnServer({ serverName, ... })`**,server 必须
 * 由 `pi/toolCatalog` 的 route 显式给出。历史"按裸 toolName 查全局 map"的
 * 路径已删,详见 [ai.prompt.md] "注意事项 > server-scoped"。
 */

import { McpClient } from './mcpClient';
import { mcpAuthService } from './auth';
import { activeMcp, patchServerConfig } from './manager/configStore';
import { OperationLockRegistry } from './manager/operationLock';
import { RuntimeStateStore } from './manager/runtimeStateStore';
import {
  transformTools,
  type MCPServerRuntimeState,
  type McpTool,
} from './manager/types';
import { log } from '@main/log';
import type { McpServerConfig } from '@shared/types/profileTypes';

// 供外部导入的公共类型 —— 保持与旧文件相同的模块出口。
export type { MCPServerRuntimeState, MCPServerStatus } from './manager/types';

/**
 * `client.cleanup()` 的最长等待。内部路径 `sdk.close() → StdioTransport.stop()`
 * 已经串了 SIGTERM → 5s → SIGKILL 兜底,10s 还没 resolve 的只可能是:
 *   - 进程死了但 `exit` 事件丢了 —— 再等无益;
 *   - 内核 D-state —— 用户态无解;
 *   - 孙子进程被 init 收养 —— 那是 terminal 层 detached spawn 的活,不在此处兜底。
 * 所以超时**只放弃等待,不再做额外清理**,让 profile 切换/退出前进,别把上层卡死。
 */
const CLIENT_CLEANUP_TIMEOUT_MS = 10_000;

/**
 * 单个正在跑的连接过程 —— disconnect 强杀 connect 时靠 `abort` 让
 * `doConnect` 里的 `await client.connectToServer(signal)` 抛出,靠 `done`
 * 等它完全 settle(catch/finally 都走完)。**cleanup 归 doConnect 独占**,
 * 外部不再对同一 client 二次 cleanup。
 */
interface ActiveConnection {
  abort: AbortController;
  done: Promise<void>;
}

/** `getAllTools` 返回的形态 —— 与 `pi/mcp.ts::McpToolDef` 字段对齐。 */
export interface McpToolWithServer extends McpTool {
  serverName: string;
}

export class MCPClientManager {
  private readonly clients = new Map<string, McpClient>();
  private readonly activeConnections = new Map<string, ActiveConnection>();
  private readonly locks = new OperationLockRegistry();
  private readonly store = new RuntimeStateStore();

  private initialized = false;

  constructor() {
    // Auth consent 分发期间 server 临时进 `needs-user-interaction` —— 让
    // UI 立刻能显示 pending 状态,而不是继续显示 connecting。
    mcpAuthService.onInteraction(({ serverName, phase }) => {
      if (phase === 'consent-requested') {
        this.store.setStatus(serverName, 'needs-user-interaction');
      }
    });
  }

  // ══════════════════════════════════════════════
  //   Public API
  // ══════════════════════════════════════════════

  /**
   * 首次 bootstrap 时调,起 in_use servers 的后台自动连接。**幂等**:重复
   * 调直接短路。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.sweepGhostState();

    const items = (await activeMcp()).items;
    for (const cfg of items) {
      if (cfg.in_use) this.startBackgroundConnect(cfg.name);
    }

    this.initialized = true;
  }

  getAllMcpServerRuntimeStates(): MCPServerRuntimeState[] {
    return this.store.getAll();
  }

  getMcpServerRuntimeState(serverName: string): MCPServerRuntimeState | undefined {
    return this.store.get(serverName);
  }

  /** 已连接 server 上所有工具的扁平列表(带 serverName)。 */
  async getAllTools(): Promise<McpToolWithServer[]> {
    if (!this.initialized) return [];
    const out: McpToolWithServer[] = [];
    for (const state of this.store.getAll()) {
      if (state.status !== 'connected') continue;
      for (const tool of state.tools) {
        out.push({ ...tool, serverName: state.serverName });
      }
    }
    return out;
  }

  /**
   * Server-scoped 工具执行。caller 必须已经通过 `toolCatalog.routes` 拿到
   * `{ kind: 'mcp', serverName }` —— 不要新增按裸 toolName 查全局 map 的
   * API,那条路径存在同名工具后连接者覆盖前者的 bug。
   */
  async executeToolOnServer(args: {
    serverName: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<string> {
    const client = this.clients.get(args.serverName);
    if (!client) {
      throw new Error(`MCP server not connected: "${args.serverName}" (tool: ${args.toolName})`);
    }
    return client.executeTool({
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      signal: args.signal,
    });
  }

  async connect(serverName: string): Promise<void> {
    this.assertInitialized();
    await this.locks.run(serverName, 'connect', () => this.doConnect(serverName));
  }

  async disconnect(serverName: string): Promise<void> {
    this.assertInitialized();
    await this.locks.run(serverName, 'disconnect', () => this.doDisconnect(serverName));
  }

  async reconnect(serverName: string): Promise<void> {
    this.assertInitialized();
    await this.locks.run(serverName, 'reconnect', () => this.doReconnect(serverName));
  }

  /**
   * 添加新 server。**写盘同步、连接异步** —— IPC handler 拿到 `{ success:
   * true }` 立即返回给 renderer,连接在后台推进(状态由 store 广播)。
   */
  async add(serverName: string, newConfig: McpServerConfig): Promise<void> {
    this.assertInitialized();
    if (!serverName || !newConfig) throw new Error('Server name and configuration are required');
    if (newConfig.name !== serverName) throw new Error('Server name must match configuration name');

    const mcp = await activeMcp();
    if (mcp.get(serverName)) throw new Error(`Server "${serverName}" already exists`);

    await mcp.upsert({ ...newConfig, in_use: true });
    this.store.markConnecting(serverName);

    // 让当前 event loop 收尾(IPC 响应先返回给 renderer),再起后台连接。
    setImmediate(() => {
      this.doConnect(serverName).catch((err: unknown) => {
        log.error({
          msg: '[MCPClientManager] Background connect failed for add',
          mod: 'MCPClientManager',
          serverName,
          err,
        });
      });
    });
  }

  /** 更新 server 配置。同 `add`:写盘同步,断开+重连异步。 */
  async update(serverName: string, newConfig: McpServerConfig): Promise<void> {
    this.assertInitialized();
    if (!serverName || !newConfig) throw new Error('Server name and configuration are required');
    if (newConfig.name !== serverName) throw new Error('Server name must match configuration name');

    // 保持旧行为的两次存在性检查:先按 name 抛 "Server not found",再由 patch
    // 侧兜底抛 "Failed to update server configuration for X"(旧代码里后者
    // 逻辑上不会触发,但 IPC handler 的错误文案对齐这里)。
    const mcp = await activeMcp();
    if (!mcp.get(serverName)) throw new Error(`Server "${serverName}" not found`);

    const currentStatus = this.store.get(serverName)?.status ?? 'disconnected';
    const patched = await patchServerConfig(serverName, { ...newConfig, in_use: true });
    if (!patched) throw new Error(`Failed to update server configuration for "${serverName}"`);

    this.store.markConnecting(serverName);

    setImmediate(async () => {
      try {
        if (currentStatus !== 'disconnected') await this.doDisconnect(serverName);
        await this.doConnect(serverName);
      } catch (err) {
        log.error({
          msg: '[MCPClientManager] Background update failed',
          mod: 'MCPClientManager',
          serverName,
          err,
        });
      }
    });
  }

  /**
   * 删除 server。若连接中则先断开,再删配置,最后清 OAuth 凭据槽 —— 保证
   * 后续重添同名 server 走干净 OAuth 流程。
   */
  async delete(serverName: string): Promise<void> {
    this.assertInitialized();
    if (!serverName) throw new Error('Server name is required');

    const mcp = await activeMcp();
    // 快照配置:OAuth 槽 key 依赖 url/headers/oauth.*,配置删掉后就算不出 key。
    const cfgSnapshot = mcp.get(serverName);
    if (!cfgSnapshot) throw new Error(`Server "${serverName}" not found`);

    let configDeleted = false;
    try {
      const status = this.store.get(serverName)?.status ?? 'disconnected';
      if (status !== 'disconnected') await this.disconnect(serverName);

      await mcp.remove(serverName);
      configDeleted = true;
      this.store.remove(serverName);
    } catch (error) {
      // 对齐旧 delete 语义:非 Error 抛值统一包装成 `Failed to delete MCP
      // server`,避免 IPC handler 拿到 primitive 反序列化出奇怪文案。
      throw error instanceof Error ? error : new Error('Failed to delete MCP server');
    } finally {
      // stdio 无远程 auth,跳过。写配置失败(configDeleted=false)时不清
      // 凭据 —— 用户重试删除时会再有机会。
      if (configDeleted && cfgSnapshot.transport !== 'stdio') {
        try {
          await mcpAuthService.clearOAuthForServer(serverName, cfgSnapshot, 'all');
        } catch (e) {
          log.warn({
            msg: `[MCPClientManager] Failed to clear OAuth credentials for "${serverName}" during delete`,
            mod: 'MCPClientManager',
            serverName,
            err: e,
          });
        }
      }
    }
  }

  /** 进程退出前调。挂死超时的 client 会触发孤儿子进程清理。 */
  async cleanup(): Promise<void> {
    await this.disposeAllClients();
    this.store.dispose();
  }

  /**
   * 清空所有 in-memory 连接资源(client / activeConnection / lock)并把
   * manager 打回未初始化态。**profile 切换的 caller 侧唯一接口**:切
   * profile 前先调它 → 旧 profile 的 client 全部 cleanup、`initialized`
   * 复位;然后调 `initialize()` 起新 profile 的连接。也被 `cleanup`(进程
   * 退出)复用 —— 后者额外再调 `store.dispose()`。
   *
   * **不动 store** —— 切 profile 时 renderer 仍要通过 store 广播观察状态,
   * store 由 `sweepGhostState` 按新 baseline 精准剔除。
   *
   * cleanup 超时(>10s)只 log warn 让 caller 前进;不做额外清理 —— 见
   * `CLIENT_CLEANUP_TIMEOUT_MS` 常量注释。
   */
  async disposeAllClients(): Promise<void> {
    // 先撬掉所有 in-flight connect,再等它们完全 settle:doConnect 的 finally
    // 会自己 cleanup transport 并 delete `activeConnections[serverName]`,
    // 走完再往下清 `this.clients`,避免"activeConnections.clear() 只删 Map
    // 但底层 SDK 请求跑到 REQUEST_TIMEOUT_MS(1h)才停"。
    if (this.activeConnections.size > 0) {
      const inFlight = [...this.activeConnections.values()];
      for (const active of inFlight) active.abort.abort();
      // done 都被外壳 .catch 过,永不 reject —— allSettled 是防御性写法。
      await Promise.allSettled(inFlight.map((a) => a.done));
    }

    if (this.clients.size > 0) {
      const entries = [...this.clients.entries()];
      const results = await Promise.allSettled(
        entries.map(([, client]) =>
          Promise.race([
            client.cleanup().then(() => ({ timedOut: false as const })),
            new Promise<{ timedOut: true }>((resolve) => {
              // 进程退出 hot path。timer 必须 unref,否则 cleanup 已 settle
              // 后这个 10s timer 会让 event loop 空转到超时才真退。
              const t = setTimeout(() => resolve({ timedOut: true }), CLIENT_CLEANUP_TIMEOUT_MS);
              t.unref?.();
            }),
          ]),
        ),
      );
      const stuck = results
        .map((r, i) => (r.status === 'fulfilled' && r.value.timedOut ? entries[i][0] : null))
        .filter((n): n is string => n !== null);
      if (stuck.length > 0) {
        log.warn({
          msg: 'MCP client cleanup timed out; proceeding without waiting',
          mod: 'MCPClientManager',
          serverNames: stuck,
          timeoutMs: CLIENT_CLEANUP_TIMEOUT_MS,
        });
      }
    }

    this.clients.clear();
    this.activeConnections.clear();
    this.locks.clear();
    this.initialized = false;
  }

  // ══════════════════════════════════════════════
  //   Internal — lifecycle helpers
  // ══════════════════════════════════════════════

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('MCPClientManager not initialized');
    }
  }

  /**
   * Ghost sweep:清掉 profile 里不再存在但内存里还挂着的 client / state。
   * profile 切换或首次 bootstrap 后调,防止上个 profile 的 server 残留。
   */
  private async sweepGhostState(): Promise<void> {
    const baseline = new Set((await activeMcp()).items.map((c) => c.name));

    for (const name of [...this.clients.keys()]) {
      if (baseline.has(name)) continue;
      const client = this.clients.get(name);
      this.clients.delete(name);
      if (client) {
        try {
          await client.cleanup();
        } catch (e) {
          log.warn({
            msg: '[MCPClientManager] Ghost client cleanup failed',
            mod: 'MCPClientManager',
            serverName: name,
            err: e,
          });
        }
      }
    }

    for (const state of this.store.getAll()) {
      if (!baseline.has(state.serverName)) this.store.remove(state.serverName);
    }
  }

  /**
   * 后台异步起连接。用于 `initialize` 迭代 in_use servers —— 走 lock 保护,
   * 与手动 connect 撞车时靠 "is currently connecting" 错误静默去重。
   */
  private startBackgroundConnect(serverName: string): void {
    this.locks
      .run(serverName, 'connect', () => this.doConnect(serverName))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // 撞锁静默 —— 说明手动 connect 已经在跑。
        if (msg.includes('is currently connecting')) return;
        log.error({ msg: `Failed to auto-connect server "${serverName}": ${msg}`, mod: 'MCPClientManager' });
      });
  }

  // ══════════════════════════════════════════════
  //   Internal — connect / disconnect / reconnect
  // ══════════════════════════════════════════════

  /**
   * 外壳(同步):建 abort 与 in-flight 记录,把内层的 promise 塞进
   * `activeConnections`。
   *
   * **拆两层的关键**:内层 `_runConnect` 从函数入口到第一个真正 await
   * 之间是同步执行,`activeConnections.set` 也在同一同步 tick 完成 ——
   * 对 caller 来说 doConnect 一 return,`activeConnections` 已就绪。
   * `cancelInFlightConnect` 依赖这一点:强杀路径拿不到 in-flight 条目
   * 就等于漏掉一次 abort,doConnect 会继续跑到 REQUEST_TIMEOUT_MS 才停。
   *
   * `activeConnections.done` 是"永不 reject 的观察者版本"(`.catch(()=>{})`):
   * `cancelInFlightConnect` / `disposeAllClients` 里 `await active.done`
   * 只关心它**是否跑完**,不该被 _runConnect 内部的 throw(如 cfg 找不到)
   * 二次抛出污染调用者。原始 reject 语义由 caller 拿到的返回 promise 承载。
   */
  private doConnect(serverName: string): Promise<void> {
    const abort = new AbortController();
    const promise = this._runConnect(serverName, abort);
    const done = promise.catch(() => {});
    this.activeConnections.set(serverName, { abort, done });
    return promise;
  }

  private async _runConnect(serverName: string, abort: AbortController): Promise<void> {
    const cfg = (await activeMcp()).get(serverName);
    if (!cfg) {
      // cfg 检查发生在**外层 set 之后**(内层第一个 await 恢复时) ——
      // 抛之前必须先手动 delete,否则 activeConnections 泄漏一个死条目。
      this.activeConnections.delete(serverName);
      throw new Error(`Server "${serverName}" not found in configuration`);
    }

    this.store.setStatus(serverName, 'connecting');

    // outer scope 引用:失败/未 set 进 this.clients 时,finally 兜底 cleanup
    // 避免 transport 泄漏(new McpClient 就抛错的极端情况下也仍为 null 安全)。
    let client: McpClient | null = null;

    try {
      // 直接透传整个 cfg —— 旧代码手动挑字段时漏掉了 `oauth`,导致用户配的
      // clientId / callbackPort 到不了 transport。这里保留全字段。
      client = new McpClient(cfg);

      // 失败 / 取消统一 throw:失败已在 McpClient 内 log.warn + enrich 根因,
      // 这里只负责把 error 映射成 runtime state。
      await client.connectToServer(abort.signal);

      const tools = transformTools(await client.getTools());
      if (tools.length === 0) {
        this.store.markError(serverName, new Error('Connection successful but no tools available'));
        return;
      }

      // 只有真正连上且拿到 tools 才把 client 挂进 map、把 in_use 标 true。
      // 失败路径**不写 in_use=true** —— 否则用户手动 connect 一个 in_use=false
      // 的 server(disconnect 过或刚添加未启)失败后,下次 bootstrap 会自动
      // 重连这个已知失败的 server,与用户"试试连一下"的意图不符。
      this.clients.set(serverName, client);
      this.store.markConnected(serverName, tools);
      await this.safePatchInUse(serverName, true);
    } catch (error) {
      // abort:由 doDisconnect 后续 `setStatus('disconnecting') → markDisconnected`
      // 全权负责状态终态,这里什么都不写。
      if (abort.signal.aborted) return;
      this.store.markError(
        serverName,
        error instanceof Error ? error : new Error('Connection failed'),
      );
    } finally {
      this.activeConnections.delete(serverName);
      // **cleanup 归本函数独占** —— cancelInFlightConnect / disposeAllClients
      // 只 abort + await done,不再对同一 client 二次 cleanup。
      // 未 set 进 this.clients 的实例(失败/取消/tools 为空)兜底清 transport。
      if (client && !this.clients.has(serverName)) {
        try {
          await client.cleanup();
        } catch {
          // 已经报过错了,cleanup 再失败没必要二次告警。
        }
      }
    }
  }

  private async doDisconnect(serverName: string): Promise<void> {
    // cancelInFlightConnect 已经把 active.done 用 `.catch(()=>{})` 收敛,不
    // 抛。它返回时 in-flight doConnect 的 finally 已经走完(client 已 cleanup、
    // activeConnections 已 delete)—— 相当于一次同步屏障。
    await this.cancelInFlightConnect(serverName);
    this.store.setStatus(serverName, 'disconnecting');

    const client = this.clients.get(serverName);
    if (client) {
      this.clients.delete(serverName);
      try {
        await client.cleanup();
      } catch (e) {
        // cleanup 错误只 log 不污染 lastError,否则 UI 会在"关掉 server"
        // 后仍显示 error。
        log.warn({
          msg: '[MCPClientManager] client cleanup during disconnect failed',
          mod: 'MCPClientManager',
          serverName,
          err: e,
        });
      }
    }

    // in_use 布尔更新走 safePatchInUse —— 与 doConnect 成功分支对称,写盘
    // hiccup 只 log 不污染业务状态。这是"意愿"字段的副作用,不该让 UI 上
    // 已 disconnected 的 server 挂个红条。
    await this.safePatchInUse(serverName, false);

    this.store.markDisconnected(serverName);
  }

  /**
   * Reconnect = 先清掉现有 client(如有),再走完整 doConnect。**必须新建
   * 实例**:`McpClient` 是一次性的(`connectToServer` 成功一次后不可复连);
   * 而且复用路径原来漏了 abort/signal/in_use=true 三件事,不如直接走 doConnect
   * 拿到统一的连接语义(activeConnections 注册、abort 参与 in-flight 机制、
   * 成功后 safePatchInUse(true))。
   *
   * 与 `disconnect + connect` 的差别只有:不广播 `disconnecting` 中间态、
   * 不写 `in_use=false` 中间态 —— 与 UI 上"重连"按钮的用户预期一致。
   */
  private async doReconnect(serverName: string): Promise<void> {
    const oldClient = this.clients.get(serverName);
    if (oldClient) {
      this.clients.delete(serverName);
      try {
        await oldClient.cleanup();
      } catch (e) {
        log.warn({
          msg: '[MCPClientManager] old client cleanup during reconnect failed',
          mod: 'MCPClientManager',
          serverName,
          err: e,
        });
      }
    }
    await this.doConnect(serverName);
  }

  /**
   * 撬掉正在跑的 connect —— disconnect 前置。语义:释放 lock、abort connect
   * 的 signal、等 doConnect 完全 settle(catch/finally 都走完)。
   *
   * **cleanup 由 doConnect 独占** —— 本函数**不**自己调 `client.cleanup()`,
   * 那属于 doConnect 的 finally 分支。这里只负责"发信号 + 等它跑完",
   * 保证 disconnect 返回时子进程一定已经 stop、activeConnections 已清空。
   */
  private async cancelInFlightConnect(serverName: string): Promise<void> {
    this.locks.forceRelease(serverName);

    const active = this.activeConnections.get(serverName);
    if (!active) return;

    active.abort.abort();
    // done 已被外壳 .catch(()=>{}) 收敛,不会 reject。
    await active.done;
  }

  /**
   * 更新 in_use 但吞掉写盘错误。业务语义:即便 profile 写盘失败,连接层的
   * 状态也已经稳定(store 里 status/tools 都对),不该因写盘 hiccup 把
   * "已连成功"翻成 error。
   */
  private async safePatchInUse(serverName: string, inUse: boolean): Promise<void> {
    try {
      await patchServerConfig(serverName, { in_use: inUse });
    } catch (e) {
      log.warn({
        msg: `[MCPClientManager] patch in_use failed for "${serverName}"`,
        mod: 'MCPClientManager',
        serverName,
        inUse,
        err: e,
      });
    }
  }
}

/** 单例导出 —— 与旧文件保持相同符号名。 */
export const mcpClientManager = new MCPClientManager();
