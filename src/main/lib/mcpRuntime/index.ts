/**
 * Profile-bound MCP client manager。
 *
 * 责任:
 *   - 维护 `serverName -> McpClient` 实例;
 *   - 通过 `RuntimeStateStore` 对外暴露运行时状态(status / tools / lastError)
 *     并做 debounce IPC 推送;
 *   - 通过 `OperationLockRegistry` 保证同 server 上 connect / disconnect /
 *     reconnect 三种操作互斥;
 *   - 生命周期编排(初始化 → 按 in_use 起连接；Profile 停止 → 全量 cleanup
 *     并回收挂死子进程);
 *   - Server 增删改的对外入口;
 *   - `executeToolOnServer` 的最终派发。
 *
 * **执行入口只有 `executeToolOnServer({ serverName, ... })`**,server 必须
 * 由 `pi/tool` 的 route 显式给出。历史"按裸 toolName 查全局 map"的
 * 路径已删,详见 [ai.prompt.md] "注意事项 > server-scoped"。
 */

import { McpClient } from './mcpClient';
import { McpAuthService, type McpAuthConsentDecision } from './auth';
import { getMcpOAuthServerKey } from './auth/serverKey';
import type { McpAuthClientIdResponse } from '@shared/types/mcpAuth';
import { OperationLockRegistry } from './manager/operationLock';
import { RuntimeStateStore } from './manager/runtimeStateStore';
import {
  transformTools,
  type MCPServerRuntimeState,
  type McpTool,
} from './manager/types';
import { log } from '@main/log';
import type { McpServerConfig } from '@shared/persist/types';


/** MCP runtime 实际依赖的 ProfileStore 窄接口，便于独立验证连接生命周期。 */
interface McpRuntimeStore {
  readonly id: string;
  readonly mcp: {
    readonly items: McpServerConfig[];
    get(name: string): McpServerConfig | undefined;
    upsert(server: McpServerConfig): Promise<void>;
    remove(name: string): Promise<void>;
  };
}
// 供外部导入的公共类型 —— 保持与旧文件相同的模块出口。
export type { MCPServerRuntimeState, MCPServerStatus } from './manager/types';

/**
 * `client.cleanup()` 的最长等待。内部路径 `sdk.close() → StdioTransport.stop()`
 * 已经串了 SIGTERM → 5s → SIGKILL 兜底,10s 还没 resolve 的只可能是:
 *   - 进程死了但 `exit` 事件丢了 —— 再等无益;
 *   - 内核 D-state —— 用户态无解;
 *   - 孙子进程被 init 收养 —— 那是 terminal 层 detached spawn 的活,不在此处兜底。
 * 所以超时**只放弃等待,不再做额外清理**,让 Profile 停止 / 进程退出前进,别把上层卡死。
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

/** `getAllTools` 返回的形态 —— 供 `pi/tool.ts` 的 catalog 直接消费。 */
export interface McpToolWithServer extends McpTool {
  serverName: string;
}

export class MCPClientManager {
  private readonly clients = new Map<string, McpClient>();
  private readonly activeConnections = new Map<string, ActiveConnection>();
  private readonly locks = new OperationLockRegistry();
  private readonly runtimeState: RuntimeStateStore;
  private readonly authService: McpAuthService;
  private initialized = false;
  private readonly unsubscribeInteraction: () => void;
  private readonly pendingBackgroundOperations = new Map<string, number>();
  private nextBackgroundOperation = 0;

  public constructor(private readonly store: McpRuntimeStore) {
    this.runtimeState = new RuntimeStateStore(store.id);
    this.authService = new McpAuthService(store.id);
    // Auth consent 分发期间 server 临时进 `needs-user-interaction` —— 让
    // UI 立刻能显示 pending 状态,而不是继续显示 connecting。
    this.unsubscribeInteraction = this.authService.onInteraction(({ serverName, phase }) => {
      if (phase === 'consent-requested') {
        this.runtimeState.setStatus(serverName, 'needs-user-interaction');
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
    this.initialized = true;

    for (const cfg of this.store.mcp.items) {
      if (cfg.in_use) this.startBackgroundConnect(cfg.name);
    }
  }
  public getAllMcpServerRuntimeStates(): MCPServerRuntimeState[] {
    return this.runtimeState.getAll();
  }
  public getMcpServerRuntimeState(serverName: string): MCPServerRuntimeState | undefined {
    return this.runtimeState.get(serverName);
  }

  /** 已连接 server 上所有工具的扁平列表(带 serverName)。 */
  async getAllTools(): Promise<McpToolWithServer[]> {
    if (!this.initialized) return [];
    const out: McpToolWithServer[] = [];
    for (const state of this.runtimeState.getAll()) {
      if (state.status !== 'connected') continue;
      for (const tool of state.tools) {
        out.push({ ...tool, serverName: state.serverName });
      }
    }
    return out;
  }

  /**
   * Server-scoped 工具执行。caller 必须已经通过 `pi/tool.ts` 的 `ToolCatalog.getRoute`
   * 限定名精确拿到 `{ kind: 'mcp', serverName, toolName }`，不要新增按裸
   * toolName 查全局 map 的 API；那条路径存在同名工具后连接者覆盖前者的 bug。
   */
  async executeToolOnServer(args: {
    serverName: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<string> {
    this.assertInitialized();
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

  respondAuthConsent(requestId: string, decision: McpAuthConsentDecision): boolean {
    return this.authService.respondConsent(requestId, decision);
  }

  respondAuthClientId(requestId: string, response: McpAuthClientIdResponse): boolean {
    return this.authService.respondClientId(requestId, response);
  }

  cancelAuthPrompts(): void {
    this.authService.cancelPendingPrompts();
  }

  async connect(serverName: string): Promise<void> {
    this.assertInitialized();
    await this.locks.run(serverName, 'connect', () => this.doConnect(serverName));
  }

  async disconnect(serverName: string): Promise<void> {
    this.assertInitialized();
    await this.cancelInFlightConnect(serverName);
    this.assertInitialized();
    await this.locks.runWhenIdle(serverName, 'disconnect', () => this.doDisconnect(serverName));
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

    const mcp = this.store.mcp;
    if (mcp.get(serverName)) throw new Error(`Server "${serverName}" already exists`);
    await mcp.upsert({ ...newConfig, in_use: true });
    this.runtimeState.markConnecting(serverName);

    this.deferBackgroundOperation(serverName, () => this.startBackgroundConnect(serverName));
  }

  /** 更新 server 配置。同 `add`:写盘同步,断开+重连异步。 */
  async update(serverName: string, newConfig: McpServerConfig): Promise<void> {
    this.assertInitialized();
    if (!serverName || !newConfig) throw new Error('Server name and configuration are required');
    if (newConfig.name !== serverName) throw new Error('Server name must match configuration name');

    const mcp = this.store.mcp;
    const existing = mcp.get(serverName);
    if (!existing) throw new Error(`Server "${serverName}" not found`);

    const updatedConfig = { ...existing, ...newConfig, name: serverName, in_use: true };
    const existingOAuthKey = getMcpOAuthServerKey(serverName, existing);
    const updatedOAuthKey = getMcpOAuthServerKey(serverName, updatedConfig);
    if (existingOAuthKey !== updatedOAuthKey) {
      await this.authService.clearAllOAuthForServer(serverName);
    }
    await mcp.upsert(updatedConfig);

    this.runtimeState.markConnecting(serverName);

    this.deferBackgroundOperation(serverName, () => {
      void this.locks
        .runWhenIdle(serverName, 'reconnect', () => this.doReconnect(serverName))
        .catch((err: unknown) => {
          log.error({
            msg: '[MCPClientManager] Background update failed',
            mod: 'MCPClientManager',
            serverName,
            err,
          });
        });
    });
  }

  async clearOAuthForServer(
    serverName: string,
    cfg: McpServerConfig,
    scope: 'tokens' | 'all' = 'tokens',
  ): Promise<void> {
    this.assertInitialized();
    await this.authService.clearOAuthForServer(serverName, cfg, scope);
  }

  /**
   * 删除 server。先清除所有历史 OAuth 槽，再删配置；这样不会让旧 refresh
   * token 因配置身份变化而成为不可达的孤儿记录。
   */
  async delete(serverName: string): Promise<void> {
    this.assertInitialized();
    if (!serverName) throw new Error('Server name is required');

    const mcp = this.store.mcp;
    if (!mcp.get(serverName)) throw new Error(`Server "${serverName}" not found`);

    this.pendingBackgroundOperations.delete(serverName);
    const status = this.runtimeState.get(serverName)?.status ?? 'disconnected';
    if (status !== 'disconnected') await this.disconnect(serverName);

    await this.authService.clearAllOAuthForServer(serverName);
    await mcp.remove(serverName);
    this.runtimeState.remove(serverName);
  }

  async cleanup(): Promise<void> {
    // 先关 lifecycle gate，后续 IPC / 延迟重连都不能在关闭过程中重建 client。
    this.initialized = false;
    this.pendingBackgroundOperations.clear();
    this.authService.cancelPendingPrompts();
    await this.disposeAllClients();
    this.unsubscribeInteraction();
    this.runtimeState.dispose();
  }

  /**
   * 清空所有 in-memory 连接资源(client / activeConnection / lock)并把
   * manager 打回未初始化态。`cleanup` 供 Profile 停止 / 进程退出复用；它会
   * 先取消尚未执行的后台连接与认证 prompt，再等待已启动 client cleanup。
   *
   * cleanup 超时(>10s)只 log warn 让 caller 前进;不做额外清理 —— 见
   * `CLIENT_CLEANUP_TIMEOUT_MS` 常量注释。
   */
  async disposeAllClients(): Promise<void> {
    // `disposeAllClients` 也可被单独调用；同样必须先拒绝新工作。
    this.initialized = false;
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
   * Ghost sweep:清掉当前 Profile 配置中已不存在、但内存里仍挂着的 client / state。
   * 初始化时调用，防止配置删除后的运行时残留。
   */
  private async sweepGhostState(): Promise<void> {
    const baseline = new Set(this.store.mcp.items.map((c) => c.name));

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

    for (const state of this.runtimeState.getAll()) {
      if (!baseline.has(state.serverName)) this.runtimeState.remove(state.serverName);
    }
  }

  private deferBackgroundOperation(serverName: string, operation: () => void): void {
    const operationId = ++this.nextBackgroundOperation;
    this.pendingBackgroundOperations.set(serverName, operationId);

    setImmediate(() => {
      if (!this.initialized || this.pendingBackgroundOperations.get(serverName) !== operationId) return;
      this.pendingBackgroundOperations.delete(serverName);
      operation();
    });
  }

  /**
   * 后台异步起连接。用于 `initialize` 迭代 in_use servers —— 走 lock 保护,
   * 与手动 connect 撞车时靠 "is currently connecting" 错误静默去重。
   */
  private startBackgroundConnect(serverName: string): void {
    if (!this.initialized) return;
    void this.locks
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
    if (!this.initialized) return Promise.resolve();

    const abort = new AbortController();
    const promise = this._runConnect(serverName, abort);
    const done = promise.catch(() => {});
    this.activeConnections.set(serverName, { abort, done });
    return promise;
  }

  private async _runConnect(serverName: string, abort: AbortController): Promise<void> {
    const cfg = this.store.mcp.get(serverName);
    if (!cfg) {
      // cfg 检查发生在**外层 set 之后**(内层第一个 await 恢复时) ——
      // 仅删除本次 connection，不能误删随后建立的新连接。
      if (this.activeConnections.get(serverName)?.abort === abort) {
        this.activeConnections.delete(serverName);
      }
      throw new Error(`Server "${serverName}" not found in configuration`);
    }

    this.runtimeState.setStatus(serverName, 'connecting');

    // outer scope 引用:失败/未 set 进 this.clients 时,finally 兜底 cleanup
    // 避免 transport 泄漏(new McpClient 就抛错的极端情况下也仍为 null 安全)。
    let client: McpClient | null = null;

    try {
      // 直接透传整个 cfg —— 旧代码手动挑字段时漏掉了 `oauth`,导致用户配的
      // clientId / callbackPort 到不了 transport。这里保留全字段。
      client = new McpClient(cfg, this.authService);

      // 失败 / 取消统一 throw:失败已在 McpClient 内 log.warn + enrich 根因,
      // 这里只负责把 error 映射成 runtime state。
      await client.connectToServer(abort.signal);

      const tools = transformTools(await client.getTools());
      if (tools.length === 0) {
        this.runtimeState.markError(serverName, new Error('Connection successful but no tools available'));
        return;
      }

      // 只有成功拿到 tools 才把 client 挂进 map、把 in_use 标 true。
      // 失败路径**不写 in_use=true** —— 否则用户手动 connect 一个 in_use=false
      // 的 server(disconnect 过或刚添加未启)失败后,下次 bootstrap 会自动
      // 重连这个已知失败的 server,与用户"试试连一下"的意图不符。
      this.clients.set(serverName, client);
      this.runtimeState.markConnected(serverName, tools);
      await this.safePatchInUse(serverName, true);
    } catch (error) {
      // abort:由 doDisconnect 后续 `setStatus('disconnecting') → markDisconnected`
      // 全权负责状态终态,这里什么都不写。
      if (abort.signal.aborted) return;
      this.runtimeState.markError(
        serverName,
        error instanceof Error ? error : new Error('Connection failed'),
      );
    } finally {
      if (this.activeConnections.get(serverName)?.abort === abort) {
        this.activeConnections.delete(serverName);
      }
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
    this.runtimeState.setStatus(serverName, 'disconnecting');

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

    this.runtimeState.markDisconnected(serverName);
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
    // 配置更新的后台任务可能在 Profile 停止期间才取得锁；`doConnect` 会再次
    // 检查 lifecycle gate，确保不会在 cleanup 后重建 client。
    if (!this.initialized) return;
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
   * 取消正在跑的 connect 并等待它完整收尾。连接锁由原 `run()` 自然释放；
   * 此处不得提前删锁，否则旧操作的 finally 可能误删后继操作的锁。
   */
  private async cancelInFlightConnect(serverName: string): Promise<void> {
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
      const existing = this.store.mcp.get(serverName);
      if (!existing) return;
      await this.store.mcp.upsert({ ...existing, in_use: inUse });
    } catch (error) {
      log.warn({
        msg: `[MCPClientManager] patch in_use failed for "${serverName}"`,
        mod: 'MCPClientManager',
        serverName,
        inUse,
        err: error,
      });
    }
  }
}

