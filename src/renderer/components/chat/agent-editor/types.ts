// Agent Chat Editor type definitions

// Agent MCP Server config - contains server name and selected tools
export interface AgentMcpServer {
  name: string;
  tools: string[]; // Empty array means use all tools; otherwise only use specified tools
}

export interface AgentConfig {
  id: string
  name: string
  emoji: string
  avatar?: string // Agent avatar URL
  role: string
  model: string
  workspace?: string // Agent working directory path
  version?: string // Agent version number
  mcpServers: AgentMcpServer[] // MCP server config array
  /** 本地工具白名单。缺席/空 ⇒ 全开;非空 ⇒ 仅列表内。与 mcpServers 独立。 */
  tools?: string[]
  systemPrompt: string
  skills?: string[] // List of Skill names used by this Agent
  subAgents?: string[] // List of Sub-Agent names used by this Agent
  locked?: boolean // 受保护标记:true ⇒ 身份/系统提示词/内置skill 不可改、不可删
  createdAt: Date
  updatedAt: Date
}

export type AgentEditorTabName = 'basic' | 'knowledge' | 'mcp' | 'tools' | 'skills' | 'sub_agents' | 'prompt'

export interface TabComponentProps {
  mode: 'add' | 'update'
  agentId?: string
  agentData?: AgentConfig
  onSave: (data: Partial<AgentConfig>) => Promise<AgentConfig> // Returns the fully updated AgentConfig
  onAgentCreated?: (agentId: string) => void // Callback after Basic Tab creation succeeds in Add mode
  onDataChange?: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void // Change tracking callback
  cachedData?: Partial<AgentConfig> | null // Cached modified data, used to preserve changes when switching tabs
  fieldErrors?: Record<string, string> // Field-level error messages
  readOnly?: boolean // Read-only mode
}

export interface TabState {
  activeTab: AgentEditorTabName
  tabsEnabled: {
    basic: boolean
    knowledge: boolean
    mcp: boolean
    tools: boolean
    skills: boolean
    sub_agents: boolean
    prompt: boolean
  }
  agentCreated: boolean // Flag indicating whether the agent has been created in Add mode
}

export interface EmojiPickerProps {
  isOpen: boolean
  onClose: () => void
  onEmojiSelect: (emoji: string) => void
  currentEmoji?: string
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  showPreview: boolean
  onTogglePreview: () => void
  readOnly?: boolean // Read-only mode, prevents editing content
}