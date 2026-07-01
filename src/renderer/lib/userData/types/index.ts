/**
 * 渲染端 userData 模块的公共类型 re-export 入口（历史命名 "Profile Operations V2"
 * 已退役；本文件只保留少量 MCP runtime 形态 + ChatSession Op 形态）。
 */

// Re-export backend types for consistency
export type {
  Profile,
  GhcUser,
  GhcTokens,
  ModelConfig,
  McpServerConfig,
  AgentMcpServer,
  AgentEnvelope,
  AgentPersona,
  ChatSession,
  StarredChatSessionIndexItem,
  SkillConfig,
  SubAgentConfig,
  SubAgentContextAccess,
  ZeroStates,
  QuickStartItem
} from '@shared/types/profileTypes'
export type { SchedulerJob } from '../../../../main/lib/scheduler/types'

// Re-export App configuration types
export type { AppConfig, RuntimeEnvironment } from '@shared/types/appConfig'
export { DEFAULT_RUNTIME_ENVIRONMENT, DEFAULT_APP_CONFIG, isAppConfig, isRuntimeEnvironment } from '@shared/types/appConfig'

/**
 * MCP Server status enumeration - matches backend
 * @deprecated Please import this type from mcpClientCacheManager
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting' | 'needs-user-interaction'

/**
 * MCP Tool interface - consistent with backend runtime state
 * @deprecated Please import this type from mcpClientCacheManager
 */
export interface MCPTool {
  name: string
  description?: string  // Optional to match backend
  inputSchema: any
  serverId: string
}

/**
 * Runtime state for MCP servers - matches backend exactly
 * @deprecated Please import this type from mcpClientCacheManager
 */
export interface MCPServerRuntimeState {
  serverName: string
  status: MCPServerStatus
  tools: { name: string; description?: string; inputSchema: any }[]
  lastError: string | null  // Use string for frontend serialization
}

/**
 * Extended MCP server data that includes runtime information
 * Extends backend McpServerConfig with runtime state
 * @deprecated Please import this type from mcpClientCacheManager
 */
export interface MCPServerExtended {
  // Base config fields from McpServerConfig
  name: string
  transport: 'stdio' | 'sse' | 'StreamableHttp'
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  in_use: boolean
  /** MCP server version */
  version?: string

  // Runtime state fields
  status: MCPServerStatus
  error?: string
  tools?: MCPTool[]
  lastUpdated?: number
}


/**
 * MCP Stats interface
 * @deprecated Please import this type from mcpClientCacheManager
 */
export interface MCPStats {
  totalServers: number
  connectedServers: number
  disconnectedServers: number
  errorServers: number
  totalTools: number
}

/**
 * Profile data sync response
 */
export interface ProfileSyncResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Chat Session operation result interface - frontend specific
 */
export interface ChatSessionOperationResult {
  success: boolean
  error?: string
  data?: any
}

/**
 * Session info for UI display - frontend specific
 */
export interface SessionInfo {
  chatSession_id: string
  title: string
  last_updated: string
  displayName: string
  isActive: boolean
}

/**
 * Session management utility types
 */
export interface SessionListOptions {
  sortBy?: 'last_updated' | 'title' | 'created'
  sortOrder?: 'asc' | 'desc'
  currentSessionId?: string
}
