/**
 * MCP runtime state 薄壳：包装 `mcpClientCacheManager` 的 servers / stats / tools 给 React 用。
 *
 * 为什么不与 `mcp.atom`（registry 域，订阅 persist `agent:registry:updated[kind=mcp]`）合并：
 * runtime state（连接状态 / tools 列表 / lastError）与 persist registry 两条独立信号源；
 * runtime 的真值在 main MCP runtime 进程，由 `mcpClientCacheManager` 通过自己的 IPC 维护。
 * 本文件只是把 manager 的 listener 适配到 React 订阅模型。
 */

import { useSyncExternalStore } from 'react';
import {
  mcpClientCacheManager,
  type MCPServerExtended,
  type MCPStats,
  type MCPTool,
} from '@/lib/mcp/mcpClientCacheManager';

function subscribe(cb: () => void): () => void {
  return mcpClientCacheManager.subscribe(() => cb());
}

function getServersSnapshot(): MCPServerExtended[] {
  return mcpClientCacheManager.getMCPServers();
}

/** React Hook：MCP server runtime 列表。 */
export function useMcpRuntimeServers(): MCPServerExtended[] {
  return useSyncExternalStore(subscribe, getServersSnapshot, getServersSnapshot);
}

/** React Hook：runtime 聚合 stats（每次订阅更新都重算）。 */
export function useMcpRuntimeStats(): MCPStats {
  useSyncExternalStore(subscribe, getServersSnapshot, getServersSnapshot);
  return mcpClientCacheManager.getMCPStats();
}

/** 同步取（非 React 路径用）。 */
export function getMcpRuntimeServers(): MCPServerExtended[] {
  return mcpClientCacheManager.getMCPServers();
}

export function getMcpRuntimeServerByName(name: string): MCPServerExtended | null {
  return mcpClientCacheManager.getMCPServerByName(name);
}

export function getAllMcpTools(): MCPTool[] {
  return mcpClientCacheManager.getAllMCPTools();
}

/** 触发一次主进程 server status 刷新（renderer 主动 pull）。 */
export async function refreshMcpRuntime(): Promise<void> {
  await mcpClientCacheManager.refresh();
}
