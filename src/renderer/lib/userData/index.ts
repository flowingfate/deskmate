/**
 * Profile Operations Module
 *
 * 老 ProfileDataManager 已退役（PR-L2-6）；本目录现仅保留 appDataManager
 * + voice input hook + 类型 barrel 给其他模块复用。
 */

// 🆕 AppDataManager — frontend app.json cache manager (renderer process only)
export { AppDataManager, appDataManager } from './appDataManager'
export type { AppDataListener } from './appDataManager'
export type { AppConfig, RuntimeEnvironment, RuntimeMode } from './types'

// Export all types for use in other parts of the application
export type {
  // Core types from backend
  Profile,
  GhcUser,
  GhcTokens,
  ModelConfig,
  McpServerConfig,

  // Frontend-specific types
  MCPServerStatus,
  MCPTool,
  MCPServerRuntimeState,
  MCPServerExtended,
  MCPStats,
  ProfileSyncResponse
} from './types'
