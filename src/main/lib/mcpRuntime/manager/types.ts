/**
 * MCP runtime 共享类型 —— 从旧 `mcpClientManager.ts` 顶部拆出。
 *
 * 保持 `MCPServerStatus` / `MCPServerRuntimeState` 的形状不变:renderer 侧
 * `mcpClientCacheManager.ts` 通过 IPC 消费同名类型,主进程只在这里定义源头。
 */

import type { Tool as SdkTool } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP tool as surfaced to `mcpClientManager` / `pi/tool`.
 *
 * 结构对齐 `McpClient.getTools()` 与 `mcpClientManager.getAllTools()`:
 * `inputSchema` 保持 `unknown`(等价于历史 `any`,但在本模块内不再引入 `any`),
 * 由 `pi/tool.ts` 的 catalog 段包成 typebox `Type.Unsafe`。
 */
export interface Tool {
  name: string;
  description?: string;
  inputSchema: unknown;
  annotations?: SdkTool['annotations'];
}


/** 单个 MCP 工具的运行时描述,对齐 `pi/mcp.ts::McpToolDef` 的字段契约。 */
export interface McpTool {
  name: string;
  description?: string;
  /**
   * MCP 协议的工具入参 JSON Schema。结构由各工具自定,用 `Record<string,
   * unknown>` 与下游 `pi.Type.Unsafe(schema)` 保持结构兼容 —— SDK 内部
   * `Tool.inputSchema` 是 `unknown`,在 store 边界处经 `normalizeInputSchema`
   * 收窄。
   */
  inputSchema: Record<string, unknown>;
  annotations?: SdkTool['annotations'];
}

export function transformTools(tools: readonly Tool[]): McpTool[] {
  // `McpClient.getTools()` 已返回 store 兼容的 McpTool 形态;这里补一次
  // inputSchema 收窄,防御未来 client 实现改动或非标 MCP server 返回怪值。
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: normalizeInputSchema(t.inputSchema),
    annotations: t.annotations,
  }));
}

/**
 * 与 renderer 侧运行时状态映射一一对应。任何字段变动都要同步
 * `src/renderer/lib/mcp/mcpClientCacheManager.ts::MCPServerRuntimeState` 与
 * `shared/ipc/mcp.ts::McpServerRuntimeState`。
 */
export type MCPServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disconnecting'
  | 'needs-user-interaction';

/** MCP server 运行时状态(仅内存,永不落盘)。 */
export interface MCPServerRuntimeState {
  serverName: string;
  status: MCPServerStatus;
  tools: McpTool[];
  lastError: Error | null;
}

/**
 * 把 SDK/客户端返回的 `inputSchema: unknown` 收窄到 store 侧的
 * `Record<string, unknown>`。非对象值(理论上不该发生,但 MCP server 有权
 * 乱来)统一喂空对象,避免下游 `pi.Type.Unsafe(schema)` 拿到 `null` /
 * primitive 出格。
 *
 * 保留成命名函数是因为:
 *   1. 是运行时 type guard,inline 后表达式( `v !== null && typeof v ===
 *      'object' && !Array.isArray(v) ? v : {}` )在 tools.map 里可读性明显下降;
 *   2. 归一策略未来可能扩展(比如加 keyword 白名单校验),独立命名给了扩展点。
 */
export function normalizeInputSchema(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
