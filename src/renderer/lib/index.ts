// src/renderer/lib/index.ts
// Main lib index - exports all module groups

export * from './chat';

// 🆕 Refactored: MCP types exported from ./mcp first (authoritative source)
// MCP types in ./userData are marked as deprecated
export * from './mcp';

// Re-export from userData, excluding MCP types that are now in ./mcp
export {
  // Types (excluding MCP types that are now in ./mcp)
  type Profile,
  type GhcUser,
  type GhcTokens,
  type ModelConfig,
  type McpServerConfig,
  type ProfileSyncResponse
} from './userData';

// Note: ./streaming has been removed along with the legacy StreamingV2Message.
// MarkdownView (in components/chat/message/) is the sole markdown renderer now.
export { memoryOptimizer } from './perf';
export * from './utilities';
