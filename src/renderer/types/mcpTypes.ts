export interface MCPTool {
  name: string;
  description?: string;  // Make optional to match backend consistency
  inputSchema: any;
  serverId: string;
}

export interface MCPServerState {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error' | 'connecting' | 'disconnecting' | 'needs-user-interaction';
  tools: MCPTool[];
  lastUpdated: number;
  error?: string;
}

export interface GlobalMCPState {
  servers: MCPServerState[];
  tools: MCPTool[];
  isInitialized: boolean;
  lastUpdated: number;
}

// Imported MCP config related types (e.g. external mcp.json / settings.json sources)
export interface ImportedMcpServerConfig {
  name: string
  type?: 'stdio' | 'http' | 'sse' | 'StreamableHttp'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  disabled?: boolean
}

export interface ImportedMcpConfigFile {
  // Windows mcp.json format
  servers?: Record<string, ImportedMcpServerConfig>
  inputs?: any[]

  // macOS settings.json format
  mcp?: {
    servers: Record<string, ImportedMcpServerConfig>
  }
}

// Detection state interfaces
export interface DetectionState {
  isScanning: boolean
  detectedFiles: Array<{
    path: string
    exists: boolean
    isValid: boolean
    serverCount: number
    error?: string
  }>
}

// Import state interfaces
export interface ImportState {
  conflictResolution: 'skip' | 'rename' | 'overwrite'
  validateBeforeImport: boolean
  isImporting: boolean
  importProgress: number
  importResults?: ImportResult[]
}

export interface ImportResult {
  serverName: string
  status: 'success' | 'failed' | 'skipped' | 'renamed'
  originalName?: string
  error?: string
}

// Configuration state interfaces
export interface ConfigState {
  availableConfigs: DeskmateAppMCPServerConfig[]
  selectedConfigs: Set<string>
  conflictingConfigs: Set<string>
  previewConfig?: DeskmateAppMCPServerConfig
}

// Deskmate.app internal MCP server configuration format
export interface DeskmateAppMCPServerConfig {
  name: string
  transport: 'stdio' | 'sse' | 'StreamableHttp'
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  in_use: boolean
  version?: string
}

// Import dialog state
export interface McpImporterState {
  isOpen: boolean
  detection: DetectionState
  config: ConfigState
  import: ImportState
  selectedFilePath?: string
}

// Transport type mapping for conversion
export interface TransportMapping {
  sourceType?: string
  sourceUrl?: string
  deskmateTransport: 'stdio' | 'sse' | 'StreamableHttp'
}

// Conflict resolution strategies
export type ConflictResolutionStrategy = 'skip' | 'rename' | 'overwrite'

// Import validation result
export interface ImportValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  serverCount: number
}

// Batch import operation
export interface BatchImportOperation {
  selectedConfigs: ImportedMcpServerConfig[]
  conflictResolution: ConflictResolutionStrategy
  validateBeforeImport: boolean
}

// Import progress tracking
export interface ImportProgress {
  total: number
  completed: number
  current?: string
  errors: ImportResult[]
}