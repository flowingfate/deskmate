/**
 * MCP client public surface. Production consumer is `mcpClient.ts`,
 * which uses `McpClientCore` + `McpClientConfig`. Subdirectory collaboration
 * (transport / adapters / core / utils) is internal.
 */

export { McpClientCore } from './Client';
export type { McpClientConfig } from './Client';
