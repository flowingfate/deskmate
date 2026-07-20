import type { AgentMcpServer, SkillBindings } from '@shared/persist/types'
export type { AgentMcpServer }

export interface AgentConfig {
  id: string
  name: string
  description?: string
  emoji: string
  avatar?: string
  role: string
  model: string
  workspace?: string
  version?: string
  mcpServers: AgentMcpServer[]
  /** 本地工具白名单。缺席/空 ⇒ 全开;非空 ⇒ 仅列表内。与 mcpServers 独立。 */
  tools?: string[]
  systemPrompt: string
  skills?: SkillBindings
  /** 可委派的普通 Agent ID；允许保留暂不可用的 dangling ID。 */
  delegates?: string[]
  locked?: boolean
  createdAt: Date
  updatedAt: Date
}

export type AgentEditorTabName = 'basic' | 'knowledge' | 'mcp' | 'tools' | 'skills' | 'delegation' | 'prompt' | 'presets'

export interface TabComponentProps {
  mode: 'add' | 'update'
  agentId?: string
  agentData?: AgentConfig
  onDataChange?: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void
  cachedData?: Partial<AgentConfig> | null
  fieldErrors?: Record<string, string>
  readOnly?: boolean
}


export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  showPreview: boolean
  onTogglePreview: () => void
  readOnly?: boolean
}
