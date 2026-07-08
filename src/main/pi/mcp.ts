/**
 * MCP 薄包装:仅为 pi 暴露"列工具 + 按 server 执行工具"两个原子能力。
 * 所有底层选址、连接管理依然走 mcpClientManager 单例。
 *
 * 历史 `executeMcpTool(toolName, args)` 按裸 toolName 走 mcpClientManager 全局
 * `toolToServerMap` —— 多 server 同名工具会被静默覆盖。新代码一律走
 * `executeMcpToolOnServer(serverName, toolName, args)`,server 由 ToolCatalog
 * 的 route 显式给出。旧 API 仅给被废弃的 `mcp:executeTool` IPC 路径残留消费,
 * Phase 3 一并删。
 */

import { mcpClientManager } from '@main/lib/mcpRuntime'

export interface McpToolDef {
  name: string;
  description?: string;
  /** MCP 协议的工具入参 JSON Schema,结构由各工具自定。 */
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export async function listAllMcpTools(): Promise<McpToolDef[]> {
  return mcpClientManager.getAllTools();
}

/**
 * Server-scoped tool execution。catalog route 必须把 server 一并带出来 ——
 * 全局裸 toolName 路由已知存在同名覆盖 bug(见 task.md §1)。
 */
export async function executeMcpToolOnServer(
  serverName: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  return mcpClientManager.executeToolOnServer({ serverName, toolName, toolArgs, signal });
}
