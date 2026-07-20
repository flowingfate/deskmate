import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AgentPersona } from '@shared/types/profileTypes'
import { peekAgentSettingsEntry } from '@/lib/navigation/settingsEntry'
import { updateAgent } from '@/lib/chat/agentOps'
import { useAgentById, useAgents } from '@/states/agents.atom'
import { useAgentDetail } from '@/states/agentDetail.atom'
import { useToast } from '@/components/ui/ToastProvider'
import { log } from '@/log'
import type { AgentConfig, AgentEditorTabName } from '../agent-editor/types'

const logger = log.child({ mod: 'AgentEditingView' })

const ROUTE_TO_TAB: Readonly<Record<string, AgentEditorTabName>> = {
  basic: 'basic',
  knowledge: 'knowledge',
  mcp_servers: 'mcp',
  tools: 'tools',
  skills: 'skills',
  delegation: 'delegation',
  system_prompt: 'prompt',
  presets: 'presets',
}

const TAB_TO_ROUTE: Readonly<Record<AgentEditorTabName, string>> = {
  basic: 'basic',
  knowledge: 'knowledge',
  mcp: 'mcp_servers',
  tools: 'tools',
  skills: 'skills',
  delegation: 'delegation',
  prompt: 'system_prompt',
  presets: 'presets',
}

const EDITOR_TABS: readonly AgentEditorTabName[] = [
  'basic',
  'knowledge',
  'mcp',
  'tools',
  'skills',
  'delegation',
  'prompt',
  'presets',
]

function createPendingChanges(): Record<AgentEditorTabName, boolean> {
  return {
    basic: false,
    knowledge: false,
    mcp: false,
    tools: false,
    skills: false,
    delegation: false,
    prompt: false,
    presets: false,
  }
}

function createChangesCache(): Record<AgentEditorTabName, Partial<AgentConfig> | null> {
  return {
    basic: null,
    knowledge: null,
    mcp: null,
    tools: null,
    skills: null,
    delegation: null,
    prompt: null,
    presets: null,
  }
}

function toPersonaPatch(data: Partial<AgentConfig>): Partial<AgentPersona> {
  const patch: Partial<AgentPersona> = {}
  if (data.name !== undefined) patch.name = data.name
  if (data.description !== undefined) patch.description = data.description
  if (data.emoji !== undefined) patch.emoji = data.emoji
  if (data.role !== undefined) patch.role = data.role
  if (data.model !== undefined) patch.model = data.model
  if (data.mcpServers !== undefined) patch.mcp_servers = data.mcpServers
  if (data.tools !== undefined) patch.tools = data.tools
  if (data.skills !== undefined) patch.skills = data.skills
  if (data.delegates !== undefined) patch.delegates = data.delegates
  if (data.systemPrompt !== undefined) patch.system_prompt = data.systemPrompt
  return patch
}

interface AgentEditorState {
  activeTab: AgentEditorTabName
  agentData: AgentConfig | undefined
  canSaveAll: boolean
  error: string | null
  fieldErrors: Record<string, string>
  handleBack: () => void
  handleClearError: () => void
  handleSaveAll: () => Promise<void>
  handleTabDataChange: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void
  handleTabSwitch: (tab: AgentEditorTabName) => void
  isLoading: boolean
  pendingChanges: Record<AgentEditorTabName, boolean>
  pendingCount: number
  tabChangesCache: Record<AgentEditorTabName, Partial<AgentConfig> | null>
}

export function useAgentEditorState(agentId: string, tabParam: string | undefined): AgentEditorState {
  const navigate = useNavigate()
  const currentAgent = useAgentById(agentId)
  const detail = useAgentDetail(agentId)
  const allAgents = useAgents()
  const { showSuccess } = useToast()
  const activeTab = ROUTE_TO_TAB[tabParam ?? ''] ?? 'basic'
  const [agentData, setAgentData] = useState<AgentConfig | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [pendingChanges, setPendingChanges] = useState<Record<AgentEditorTabName, boolean>>(createPendingChanges)
  const [tabChangesCache, setTabChangesCache] = useState<Record<AgentEditorTabName, Partial<AgentConfig> | null>>(createChangesCache)

  useEffect(() => {
    if (tabParam === 'schedules') {
      navigate(`/agent/${agentId}/job`, { replace: true })
      return
    }
    const tab = ROUTE_TO_TAB[tabParam ?? '']
    if (!tab) {
      navigate(`/agent/${agentId}/settings/basic`, { replace: true })
      return
    }
  }, [agentId, navigate, tabParam])

  useEffect(() => {
    if (!currentAgent) {
      logger.error({ msg: 'Agent not found', agentId })
      setError('Agent not found')
      return
    }
    setAgentData({
      id: currentAgent.id,
      name: currentAgent.name,
      description: currentAgent.description,
      emoji: currentAgent.emoji ?? '',
      avatar: currentAgent.avatar,
      role: '',
      model: currentAgent.model,
      version: currentAgent.version,
      mcpServers: detail?.mcpServers ?? [],
      tools: detail?.tools,
      systemPrompt: detail?.systemPrompt ?? '',
      skills: detail?.skills,
      delegates: detail?.delegates,
      locked: currentAgent.locked,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    setError(null)
  }, [agentId, currentAgent, detail])

  const handleTabDataChange = useCallback((tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => {
    setPendingChanges((previous) => ({ ...previous, [tabName]: hasChanges }))
    setTabChangesCache((previous) => ({ ...previous, [tabName]: hasChanges ? data : null }))
  }, [])

  const allChanges = useMemo(() => {
    const changes: Partial<AgentConfig> = {}
    for (const tab of EDITOR_TABS) {
      if (!pendingChanges[tab]) continue
      const cached = tabChangesCache[tab]
      if (cached) Object.assign(changes, cached)
    }
    return changes
  }, [pendingChanges, tabChangesCache])
  const pendingCount = useMemo(() => EDITOR_TABS.filter((tab) => pendingChanges[tab]).length, [pendingChanges])
  const validationError = useMemo(() => {
    if (!agentData) return null
    const name = allChanges.name ?? agentData?.name
    if (!name?.trim()) return 'Agent name is required.'
    if (allAgents.some((agent) => agent.id !== agentId && agent.name === name.trim())) {
      return `Agent name "${name.trim()}" already exists. Please choose a different name.`
    }
    return null
  }, [agentData?.name, agentId, allAgents, allChanges.name])
  const canSaveAll = pendingCount > 0 && validationError === null

  useEffect(() => {
    if (validationError) {
      setFieldErrors((previous) => previous.name === validationError ? previous : { name: validationError })
      if (activeTab !== 'basic') {
        navigate(`/agent/${agentId}/settings/basic`, { replace: true })
      }
      return
    }
    setFieldErrors((previous) => previous.name === undefined ? previous : {})
  }, [activeTab, agentId, navigate, validationError])

  const handleTabSwitch = useCallback((tab: AgentEditorTabName) => {
    navigate(`/agent/${agentId}/settings/${TAB_TO_ROUTE[tab]}`)
  }, [agentId, navigate])
  const handleClearError = useCallback(() => setError(null), [])

  const handleSaveAll = useCallback(async () => {
    if (!canSaveAll) return
    setError(null)
    setIsLoading(true)
    try {
      const result = await updateAgent(agentId, toPersonaPatch(allChanges))
      if (!result.success) throw new Error(result.error ?? 'Failed to update agent')
      setAgentData((current) => current ? { ...current, ...allChanges, updatedAt: new Date() } : current)
      setPendingChanges(createPendingChanges())
      setTabChangesCache(createChangesCache())
      showSuccess('All changes saved successfully')
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'An unknown error occurred'
      setError(`Failed to save: ${message}`)
    } finally {
      setIsLoading(false)
    }
  }, [agentId, allChanges, canSaveAll, showSuccess])

  const handleBack = useCallback(() => {
    const entryPath = peekAgentSettingsEntry();
    navigate(entryPath ?? `/agent/${agentId}`);
  }, [agentId, navigate])

  return {
    activeTab,
    agentData,
    canSaveAll,
    error,
    fieldErrors,
    handleBack,
    handleClearError,
    handleSaveAll,
    handleTabDataChange,
    handleTabSwitch,
    isLoading,
    pendingChanges,
    pendingCount,
    tabChangesCache,
  }
}
