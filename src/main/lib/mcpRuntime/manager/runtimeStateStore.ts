/**
 * MCP server 运行时状态的内存 store。
 *
 * 从旧 `mcpClientManager.ts` 拆出的三块高凝聚代码:
 *   1. `runtimeStates: Map<serverName, MCPServerRuntimeState>` 存储与增改;
 *   2. 状态变更后的 50ms debounce IPC 广播(通过 `mcpMainToRender.
 *      serverStatesUpdated`);
 *   3. `Error` → 字符串消息的序列化(渲染进程只吃 `string | null`)。
 *
 * 复合语义方法(`markConnecting` / `markConnected` / `markError` /
 * `markDisconnected`)专门处理"三个字段同步改"的模式,让上层连接编排代码
 * 少重复三行 boilerplate。
 */

import { mcpMainToRender } from '@shared/ipc/mcp';
import { mainWindowForProfile } from '@main/startup/wins';
import type { MCPServerRuntimeState, MCPServerStatus, McpTool } from './types';

/** 序列化后推给 renderer 的 payload 形态,与 `shared/ipc/mcp.ts` 对齐。 */
interface SerializedRuntimeState {
  serverName: string;
  status: MCPServerStatus;
  tools: McpTool[];
  lastError: string | null;
}

const NOTIFY_DEBOUNCE_MS = 50;

export class RuntimeStateStore {
  private readonly states = new Map<string, MCPServerRuntimeState>();
  private notifyTimer: NodeJS.Timeout | null = null;

  public constructor(private readonly profileId: string) {}

  /** 只读快照 —— 供 IPC `getServerStatus` / `getAllTools` 聚合使用。 */
  getAll(): MCPServerRuntimeState[] {
    return [...this.states.values()];
  }

  get(serverName: string): MCPServerRuntimeState | undefined {
    return this.states.get(serverName);
  }

  setStatus(serverName: string, status: MCPServerStatus): void {
    this.ensure(serverName).status = status;
    this.scheduleNotify();
  }

  setTools(serverName: string, tools: McpTool[]): void {
    this.ensure(serverName).tools = tools;
    this.scheduleNotify();
  }

  setError(serverName: string, error: Error | null): void {
    this.ensure(serverName).lastError = error;
    this.scheduleNotify();
  }

  /** 移除某 server 的运行时槽 —— delete config / ghost sweep 用。 */
  remove(serverName: string): void {
    this.states.delete(serverName);
    this.scheduleNotify();
  }

  // ─────────────── 复合状态转移 ───────────────

  /** connecting 起手:清空历史 tools 与 error,状态置 connecting。 */
  markConnecting(serverName: string): void {
    const state = this.ensure(serverName);
    state.status = 'connecting';
    state.tools = [];
    state.lastError = null;
    this.scheduleNotify();
  }

  /** 连接成功:tools 拉齐,清 error,置 connected。 */
  markConnected(serverName: string, tools: McpTool[]): void {
    const state = this.ensure(serverName);
    state.status = 'connected';
    state.tools = tools;
    state.lastError = null;
    this.scheduleNotify();
  }

  /** 连接失败:记录 error,清 tools,置 error。 */
  markError(serverName: string, error: Error): void {
    const state = this.ensure(serverName);
    state.status = 'error';
    state.tools = [];
    state.lastError = error;
    this.scheduleNotify();
  }

  /** 断开:清 tools + error,置 disconnected。 */
  markDisconnected(serverName: string): void {
    const state = this.ensure(serverName);
    state.status = 'disconnected';
    state.tools = [];
    state.lastError = null;
    this.scheduleNotify();
  }

  // ─────────────── 生命周期 ───────────────

  /** manager cleanup 调:清 timer + 清 map,不再广播。 */
  dispose(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    this.states.clear();
  }

  // ─────────────── 内部 ───────────────

  private ensure(serverName: string): MCPServerRuntimeState {
    const existing = this.states.get(serverName);
    if (existing) return existing;
    const created: MCPServerRuntimeState = {
      serverName,
      status: 'disconnected',
      tools: [],
      lastError: null,
    };
    this.states.set(serverName, created);
    return created;
  }

  private scheduleNotify(): void {
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.broadcast();
    }, NOTIFY_DEBOUNCE_MS);
  }

  private broadcast(): void {
    const states: SerializedRuntimeState[] = this.getAll().map((s) => ({
      serverName: s.serverName,
      status: s.status,
      tools: s.tools,
      lastError: s.lastError ? s.lastError.message : null,
    }));
    mainWindowForProfile(this.profileId, (win) => {
      mcpMainToRender.bindWebContents(win.webContents).serverStatesUpdated(states);
    });
  }
}
