import React, { useState, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AgentBasicTab from '../agent-editor/AgentBasicTab'
import AgentKnowledgeBaseTab from '../agent-editor/AgentKnowledgeBaseTab'
import AgentMcpServersTab from '../agent-editor/AgentMcpServersTab'
import AgentToolsTab from '../agent-editor/AgentToolsTab'
import AgentSkillsTab from '../agent-editor/AgentSkillsTab'
import AgentSubAgentsTab from '../agent-editor/AgentSubAgentsTab'
import AgentSystemPromptTab from '../agent-editor/AgentSystemPromptTab'
import AgentPresetsTab from '../agent-editor/AgentPresetsTab'
import ErrorHandler from '../agent-editor/ErrorHandler'
import { TabState, AgentConfig, AgentEditorTabName } from '../agent-editor/types'
import { useAgentById, useAgents } from '@/states/agents.atom'
import { useAgentDetail } from '@/states/agentDetail.atom'
import { getAgentSessions } from '@/states/sessionIndex.atom'
import { updateAgent } from '../../../lib/chat/agentOps'
import { AgentPersona } from '../../../lib/userData/types'
import { useToast } from '../../ui/ToastProvider'
import { useFeatureFlag } from '../../../lib/featureFlags'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/shadcn/button'
import AgentPane from '@/pages/layout/agent/agent-pane'
import { AgentAvatar } from '../../common/AgentAvatar'
import AgentSettingsNav from '../agent-editor/AgentSettingsNav'
import { log } from '@/log'

const logger = log.child({ mod: 'AgentEditingView' })


/**
 * AgentEditingView - Agent editing view component
 *
 * Routes:
 *   - /agent/:agentId/settings (defaults to redirecting to basic)
 *   - /agent/:agentId/settings/basic
 *   - /agent/:agentId/settings/mcp_servers
 *   - /agent/:agentId/settings/skills
 *   - /agent/:agentId/settings/system_prompt
 *
 * This component was refactored from AgentChatEditor (modal overlay),
 * and now renders as a normal View component in the main content area.
 *
 * Features:
 * - Loads Agent config and Tab based on URL params agentId and tab
 * - Provides multi-Tab editing interface (Basic, MCP Servers, Skills, Schedules, System Prompt)
 * - Supports change tracking and batch saving
 * - Supports Tab-level URL routing
 */
const AgentEditingView: React.FC = () => {
  const { agentId, '*': tabParam } = useParams<{ agentId: string; '*': string }>()
  const navigate = useNavigate()

  // Use atom-based agent data; chats[] / useChats / useProfileData 已退役
  const currentAgent = useAgentById(agentId)
  const detail = useAgentDetail(agentId)
  const allAgents = useAgents()
  const { showSuccess, showError } = useToast()

  // Tab route mapping
  const tabRouteMap = {
    'basic': 'basic',
    'knowledge': 'knowledge',
    'mcp_servers': 'mcp',
    'tools': 'tools',
    'skills': 'skills',
    'sub_agents': 'sub_agents',
    'system_prompt': 'prompt',
    'presets': 'presets',
  } as const

  // Reverse mapping - from internal tab name to route
  const tabToRouteMap = {
    'basic': 'basic',
    'knowledge': 'knowledge',
    'mcp': 'mcp_servers',
    'tools': 'tools',
    'skills': 'skills',
    'sub_agents': 'sub_agents',
    'prompt': 'system_prompt',
    'presets': 'presets',
  } as const

  // Get current tab from URL, default to basic
  const getCurrentTabFromUrl = (): AgentEditorTabName => {
    if (!tabParam) return 'basic'
    const mappedTab = tabRouteMap[tabParam as keyof typeof tabRouteMap]
    return mappedTab || 'basic'
  }

  // Tab state management - all tabs enabled by default in edit mode
  const [tabState, setTabState] = useState<TabState>({
    activeTab: getCurrentTabFromUrl(),
    tabsEnabled: {
      basic: true,
      knowledge: true,
      mcp: true,
      tools: true,
      skills: true,
      sub_agents: true,
      prompt: true,
      presets: true,
    },
    agentCreated: true // Agent already exists in edit mode
  })

  // Agent data state
  const [agentData, setAgentData] = useState<AgentConfig | undefined>(undefined)

  // Error handling state
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Sub-Agent feature controlled by feature flag
  const subAgentEnabled = useFeatureFlag('deskmateFeatureSubAgent')

  // Field-level error state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Key for force-resetting Tab component states
  const [tabResetKey, setTabResetKey] = useState(0)

  const readOnlyFlags = {
    basic: false,
    knowledge: false,
    mcp: false,
    tools: false,
    skills: false,
    sub_agents: false,
    prompt: false,
    presets: false,
  }

  // Change tracking state - records whether each Tab has unsaved changes
  const [pendingChanges, setPendingChanges] = useState<{
    basic: boolean
    knowledge: boolean
    mcp: boolean
    tools: boolean
    skills: boolean
    sub_agents: boolean
    prompt: boolean
    presets: boolean
  }>({
    basic: false,
    knowledge: false,
    mcp: false,
    tools: false,
    skills: false,
    sub_agents: false,
    prompt: false,
    presets: false,
  })

  // Cache modified data for each Tab
  const [tabChangesCache, setTabChangesCache] = useState<{
    basic: Partial<AgentConfig> | null
    knowledge: Partial<AgentConfig> | null
    mcp: Partial<AgentConfig> | null
    tools: Partial<AgentConfig> | null
    skills: Partial<AgentConfig> | null
    sub_agents: Partial<AgentConfig> | null
    prompt: Partial<AgentConfig> | null
    presets: Partial<AgentConfig> | null
  }>({
    basic: null,
    knowledge: null,
    mcp: null,
    tools: null,
    skills: null,
    sub_agents: null,
    prompt: null,
    presets: null,
  })

  // URL route sync - watch URL param changes and update activeTab
  useEffect(() => {
    const urlTab = getCurrentTabFromUrl()
    if (tabState.activeTab !== urlTab) {
      setTabState(prev => ({ ...prev, activeTab: urlTab }))
    }
  }, [tabParam, tabState.activeTab])


  // Load agent data from atom (chat-shaped chats[] 已退役).
  // 列表层字段（id/name/emoji/avatar/model/version/source）从 AgentRecord 拿；
  // cold 字段（systemPrompt/mcpServers/skills/subAgents）从 useAgentDetail 拿。
  // detail 还在 loading 时 currentAgent 已经 hydrated 可用 —— 此时短暂展示空表单（design §6 已列）。
  useEffect(() => {
    if (!agentId) return
    if (currentAgent) {
      const agentConfig: AgentConfig = {
        id: currentAgent.id,
        name: currentAgent.name,
        emoji: currentAgent.emoji ?? '',
        avatar: currentAgent.avatar,
        role: '',
        model: currentAgent.model,
        version: currentAgent.version,
        mcpServers: detail?.mcpServers ?? [],
        tools: detail?.tools,
        systemPrompt: detail?.systemPrompt ?? '',
        skills: detail?.skills,
        subAgents: detail?.subAgents,
        locked: currentAgent.locked,
        createdAt: new Date(),
        updatedAt: new Date()
      }
      setAgentData(agentConfig)
    } else {
      logger.error({ msg: "Agent not found for agentId:", agentId })
      setError('Agent not found')
    }
  }, [agentId, currentAgent, detail])

  // Callback for handling Tab modification state changes
  const handleTabDataChange = useCallback((tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => {
    setPendingChanges(prev => ({
      ...prev,
      [tabName]: hasChanges
    }))

    setTabChangesCache(prev => ({
      ...prev,
      [tabName]: hasChanges ? data : null
    }))
  }, [])

  // Validate all pending changes
  const validateAllChanges = useCallback(() => {
    const allChanges: Partial<AgentConfig> = {}

    if (pendingChanges.basic && tabChangesCache.basic) {
      Object.assign(allChanges, tabChangesCache.basic)
    }
    if (pendingChanges.knowledge && tabChangesCache.knowledge) {
      Object.assign(allChanges, tabChangesCache.knowledge)
    }
    if (pendingChanges.mcp && tabChangesCache.mcp) {
      Object.assign(allChanges, tabChangesCache.mcp)
    }
    if (pendingChanges.tools && tabChangesCache.tools) {
      Object.assign(allChanges, tabChangesCache.tools)
    }
    if (pendingChanges.skills && tabChangesCache.skills) {
      Object.assign(allChanges, tabChangesCache.skills)
    }
    if (pendingChanges.sub_agents && tabChangesCache.sub_agents) {
      Object.assign(allChanges, tabChangesCache.sub_agents)
    }
    if (pendingChanges.prompt && tabChangesCache.prompt) {
      Object.assign(allChanges, tabChangesCache.prompt)
    }
    // Agent Name validation - check for duplicate names
    const currentName = allChanges.name || agentData?.name

    if (currentName && currentName.trim() !== '') {
      const existingAgent = allAgents.find(a =>
        a.name === currentName.trim() && a.id !== agentId
      )

      if (existingAgent) {
        return { isValid: false, errorMessage: `Agent name "${currentName.trim()}" already exists. Please choose a different name.`, showError: true }
      }
    }

    return { isValid: true, errorMessage: null, showError: false }
  }, [pendingChanges, tabChangesCache, agentData, agentId, allAgents])

  // Check if there are any pending changes
  const pendingCount = Object.values(pendingChanges).filter(Boolean).length
  const hasAnyPendingChanges = pendingCount > 0

  // Check if save is possible (has changes and validation passes)
  const validationResult = validateAllChanges()
  const canSaveAll = hasAnyPendingChanges && validationResult.isValid

  // Use useEffect to update field errors
  useEffect(() => {
    const { isValid, errorMessage, showError: shouldShowError } = validationResult

    if (!isValid && shouldShowError && errorMessage) {
      if (fieldErrors.name !== errorMessage) {
        setFieldErrors({ name: errorMessage })
      }
      if (tabState.activeTab !== 'basic') {
        setTabState(prev => ({ ...prev, activeTab: 'basic' }))
      }
    } else {
      if (fieldErrors.name) {
        setFieldErrors({})
      }
    }
  }, [validationResult.isValid, validationResult.errorMessage, validationResult.showError, fieldErrors.name, tabState.activeTab])

  // Tab switch handler - update URL route
  const handleTabSwitch = useCallback((tab: AgentEditorTabName) => {
    if (tabState.tabsEnabled[tab] && agentId) {
      const routeTab = tabToRouteMap[tab]
      navigate(`/agent/${agentId}/settings/${routeTab}`)
    }
  }, [tabState.tabsEnabled, agentId, navigate])
  // Clear error
  const handleClearError = useCallback(() => {
    setError(null)
  }, [])

  // Data save handler - strictly isolate data by Tab
  const handleSave = useCallback(async (data: Partial<AgentConfig>): Promise<AgentConfig> => {
    setError(null)
    setIsLoading(true)

    try {
      if (!agentId) {
        throw new Error('No chat ID found for update operation')
      }

      if (!currentAgent) {
        throw new Error('Agent not found')
      }

      // Build snake_case patch for updateAgent; persist shim 只关心传入字段
      const patch: Partial<AgentPersona> = {}

      if (tabState.activeTab === 'basic') {
        if (data.name !== undefined) patch.name = data.name
        if (data.emoji !== undefined) patch.emoji = data.emoji
        if (data.role !== undefined) patch.role = data.role
        if (data.model !== undefined) patch.model = data.model
      } else if (tabState.activeTab === 'mcp') {
        if (data.mcpServers !== undefined) {
          patch.mcp_servers = data.mcpServers
        }
      } else if (tabState.activeTab === 'tools') {
        if (data.tools !== undefined) {
          patch.tools = data.tools
        }
      } else if (tabState.activeTab === 'skills') {
        if (data.skills !== undefined) {
          patch.skills = data.skills
        }
      } else if (tabState.activeTab === 'sub_agents') {
        if (data.subAgents !== undefined) {
          patch.sub_agents = data.subAgents
        }
      } else if (tabState.activeTab === 'prompt') {
        if (data.systemPrompt !== undefined) {
          patch.system_prompt = data.systemPrompt
        }
      }

      const result = await updateAgent(agentId, patch)

      if (result.success) {
        const currentAgentData = agentData || {
          id: agentId,
          name: currentAgent.name,
          emoji: currentAgent.emoji ?? '',
          role: '',
          model: currentAgent.model,
          version: currentAgent.version,
          mcpServers: detail?.mcpServers ?? [],
          tools: detail?.tools,
          systemPrompt: detail?.systemPrompt ?? '',
          locked: currentAgent.locked,
          createdAt: new Date(),
          updatedAt: new Date()
        }

        const updatedAgent: AgentConfig = { ...currentAgentData }

        if (tabState.activeTab === 'mcp') {
          updatedAgent.mcpServers = data.mcpServers !== undefined ? data.mcpServers : currentAgentData.mcpServers
        } else if (tabState.activeTab === 'tools') {
          updatedAgent.tools = data.tools !== undefined ? data.tools : currentAgentData.tools
        } else if (tabState.activeTab === 'skills') {
          updatedAgent.skills = data.skills !== undefined ? data.skills : currentAgentData.skills
        } else if (tabState.activeTab === 'sub_agents') {
          updatedAgent.subAgents = data.subAgents !== undefined ? data.subAgents : currentAgentData.subAgents
        } else if (tabState.activeTab === 'prompt') {
          updatedAgent.systemPrompt = data.systemPrompt !== undefined ? data.systemPrompt : currentAgentData.systemPrompt
        } else if (tabState.activeTab === 'basic') {
          if (data.name !== undefined) updatedAgent.name = data.name
          if (data.emoji !== undefined) updatedAgent.emoji = data.emoji
          if (data.role !== undefined) updatedAgent.role = data.role
          if (data.model !== undefined) updatedAgent.model = data.model
        }

        updatedAgent.updatedAt = new Date()
        setAgentData(updatedAgent)

        return updatedAgent
      } else {
        throw new Error(result.error || 'Failed to update agent')
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
      setError(`Failed to save: ${errorMessage}`)
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [tabState, agentData, agentId, currentAgent, detail])

  // Unified save-all function
  const handleSaveAll = useCallback(async () => {
    if (!canSaveAll) return

    setIsLoading(true)
    setError(null)

    try {
      // Collect all pending changes
      const allChanges: Partial<AgentConfig> = {}

      if (pendingChanges.basic && tabChangesCache.basic) {
        Object.assign(allChanges, tabChangesCache.basic)
      }
      if (pendingChanges.knowledge && tabChangesCache.knowledge) {
        Object.assign(allChanges, tabChangesCache.knowledge)
      }
      if (pendingChanges.mcp && tabChangesCache.mcp) {
        Object.assign(allChanges, tabChangesCache.mcp)
      }
      if (pendingChanges.tools && tabChangesCache.tools) {
        Object.assign(allChanges, tabChangesCache.tools)
      }
      if (pendingChanges.skills && tabChangesCache.skills) {
        Object.assign(allChanges, tabChangesCache.skills)
      }
      if (pendingChanges.sub_agents && tabChangesCache.sub_agents) {
        Object.assign(allChanges, tabChangesCache.sub_agents)
      }
      if (pendingChanges.prompt && tabChangesCache.prompt) {
        Object.assign(allChanges, tabChangesCache.prompt)
      }
      if (!agentId) {
        throw new Error('No chat ID found for update operation')
      }

      if (!currentAgent) {
        throw new Error('Agent not found')
      }

      // Build snake_case patch covering all modified fields
      const patch: Partial<AgentPersona> = {}

      if (allChanges.name !== undefined) patch.name = allChanges.name
      if (allChanges.emoji !== undefined) patch.emoji = allChanges.emoji
      if (allChanges.role !== undefined) patch.role = allChanges.role
      if (allChanges.model !== undefined) patch.model = allChanges.model

      if (allChanges.mcpServers !== undefined) patch.mcp_servers = allChanges.mcpServers
      if (allChanges.tools !== undefined) patch.tools = allChanges.tools
      if (allChanges.skills !== undefined) patch.skills = allChanges.skills
      if (allChanges.subAgents !== undefined) patch.sub_agents = allChanges.subAgents
      if (allChanges.systemPrompt !== undefined) patch.system_prompt = allChanges.systemPrompt

      const result = await updateAgent(agentId, patch)

      if (result.success) {
        // Update local agent data — fall back to currentAgent for unchanged fields
        const updatedAgent: AgentConfig = {
          id: agentId,
          name: allChanges.name ?? currentAgent.name,
          emoji: allChanges.emoji ?? currentAgent.emoji ?? '',
          role: allChanges.role ?? '',
          model: allChanges.model ?? currentAgent.model,
          version: currentAgent.version,
          mcpServers: allChanges.mcpServers ?? detail?.mcpServers ?? [],
          tools: allChanges.tools ?? detail?.tools,
          systemPrompt: allChanges.systemPrompt ?? detail?.systemPrompt ?? '',
          skills: allChanges.skills ?? detail?.skills,
          subAgents: allChanges.subAgents ?? detail?.subAgents,
          createdAt: agentData?.createdAt || new Date(),
          updatedAt: new Date()
        }

        setAgentData(updatedAgent)
      } else {
        throw new Error(result.error || 'Failed to update agent')
      }

      // Clear all modification states
      setPendingChanges({
        basic: false,
        knowledge: false,
        mcp: false,
        tools: false,
        skills: false,
        sub_agents: false,
        prompt: false,
        presets: false,
      })
      setTabChangesCache({
        basic: null,
        knowledge: null,
        mcp: null,
        tools: null,
        skills: null,
        sub_agents: null,
        prompt: null,
        presets: null,
      })

      // Force remount all Tab components
      setTabResetKey(prev => prev + 1)

      showSuccess('All changes saved successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
      setError(`Failed to save: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }, [canSaveAll, pendingChanges, tabChangesCache, agentId, agentData, currentAgent, detail, showSuccess])

  // Navigate back to chat page
  const handleBackToChat = useCallback(() => {
    if (!agentId) {
      navigate('/agent')
      return
    }

    const sessions = getAgentSessions(agentId)
    const hasExistingSessions = sessions.length > 0

    if (!hasExistingSessions) {
      navigate(`/agent/${agentId}`, {
        state: {
          intent: 'new-chat',
          source: 'agent-settings-back'
        }
      })
      return
    }

    navigate(`/agent/${agentId}`)
  }, [agentId, navigate])

  // Default route redirect — empty tab → basic; legacy schedules tab → /agent/:agentId/job
  useEffect(() => {
    if (!agentId) return
    if (!tabParam) {
      navigate(`/agent/${agentId}/settings/basic`, { replace: true })
      return
    }
    if (tabParam === 'schedules') {
      navigate(`/agent/${agentId}/job`, { replace: true })
    }
  }, [agentId, tabParam, navigate])

  // If no agentId, show error
  if (!agentId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <p>No agent selected. Please select an agent from the left navigation.</p>
        <Button onClick={() => navigate('/agent')}>Go to Chat</Button>
      </div>
    )
  }

  return (
    <AgentPane className="flex flex-col h-full w-full bg-surface-primary">
      <AgentPane.Head>
        <div className="flex items-center gap-2.5 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleBackToChat}
            title="Back to Chat"
          >
            <ArrowLeft size={18} strokeWidth={1.75} />
          </Button>
          {agentData && (
            <AgentAvatar
              emoji={agentData.emoji}
              avatar={agentData.avatar}
              name={agentData.name}
              size="sm"
              version={agentData.version}
            />
          )}
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-sm font-semibold truncate">
              {agentData ? agentData.name : 'Agent'}
            </span>
            <span className="text-xs opacity-50 shrink-0">Settings</span>
          </div>
        </div>
      </AgentPane.Head>

      <AgentPane.Body>

        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden h-full">
          {/* Error Display */}
          {error && (
            <div className="px-6 shrink-0">
              <ErrorHandler
                error={error}
                onDismiss={handleClearError}
              />
            </div>
          )}

          {/* Left Navigation */}
          <AgentSettingsNav
            activeTab={tabState.activeTab}
            pendingChanges={pendingChanges}
            subAgentEnabled={subAgentEnabled}
            onSwitch={handleTabSwitch}
            onSaveAll={handleSaveAll}
            isLoading={isLoading}
            canSaveAll={canSaveAll}
            pendingCount={pendingCount}
          />

          {/* Right Content Area */}
          <div className="flex-1 min-w-0 overflow-hidden relative bg-white/95 box-border">
            {/* Loading Overlay */}
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-100 bg-white/70 backdrop-blur-xs">
                <Loader2 className="text-accent animate-spin" size={20} strokeWidth={2} />
                <span className="text-sm text-content-secondary font-medium">Saving...</span>
              </div>
            )}

            {/* Render only the selected Tab content based on active state */}
            {tabState.activeTab === 'basic' && (
              <AgentBasicTab
                key={`basic-${tabResetKey}`}
                mode="update"
                agentId={agentId}
                agentData={agentData}
                onSave={handleSave}
                onDataChange={handleTabDataChange}
                cachedData={tabChangesCache.basic}
                fieldErrors={fieldErrors}
                readOnly={readOnlyFlags.basic}
              />
            )}

            {tabState.activeTab === 'knowledge' && tabState.tabsEnabled.knowledge && (
              <AgentKnowledgeBaseTab
                key={`knowledge-${tabResetKey}`}
                mode="update"
                agentId={agentId}
                agentData={agentData}
                onSave={handleSave}
                onDataChange={handleTabDataChange}
                cachedData={tabChangesCache.knowledge}
                fieldErrors={fieldErrors}
                readOnly={readOnlyFlags.knowledge}
              />
            )}

            {tabState.activeTab === 'mcp' && tabState.tabsEnabled.mcp && (
              <AgentMcpServersTab
                key={`mcp-${tabResetKey}`}
                mode="update"
                agentId={agentId}
                agentData={agentData}
                onSave={handleSave}
                onDataChange={handleTabDataChange}
                cachedData={tabChangesCache.mcp}
                fieldErrors={fieldErrors}
                readOnly={readOnlyFlags.mcp}
              />
            )}

            {tabState.activeTab === 'tools' && tabState.tabsEnabled.tools && (
              <AgentToolsTab
                key={`tools-${tabResetKey}`}
                mode="update"
                agentId={agentId}
                agentData={agentData}
                onSave={handleSave}
                onDataChange={handleTabDataChange}
                cachedData={tabChangesCache.tools}
                fieldErrors={fieldErrors}
                readOnly={readOnlyFlags.tools}
              />
            )}

            {tabState.activeTab === 'skills' && tabState.tabsEnabled.skills && (
              <AgentSkillsTab
                key={`skills-${tabResetKey}`}
                mode="update"
                agentId={agentId}
                agentData={agentData}
                onSave={handleSave}
                onDataChange={handleTabDataChange}
                cachedData={tabChangesCache.skills}
                fieldErrors={fieldErrors}
                readOnly={readOnlyFlags.skills}
              />
            )}


            {subAgentEnabled && tabState.activeTab === 'sub_agents' && tabState.tabsEnabled.sub_agents && (
              <AgentSubAgentsTab
                key={`sub_agents-${tabResetKey}`}
                mode="update"
                agentId={agentId}
                agentData={agentData}
                onSave={handleSave}
                onDataChange={handleTabDataChange}
                cachedData={tabChangesCache.sub_agents}
                fieldErrors={fieldErrors}
                readOnly={readOnlyFlags.sub_agents}
              />
            )}

            {tabState.activeTab === 'prompt' && tabState.tabsEnabled.prompt && (
              <AgentSystemPromptTab
                key={`prompt-${tabResetKey}`}
                mode="update"
                agentId={agentId}
                agentData={agentData}
                onSave={handleSave}
                onDataChange={handleTabDataChange}
                cachedData={tabChangesCache.prompt}
                fieldErrors={fieldErrors}
                readOnly={readOnlyFlags.prompt}
              />
            )}

            {tabState.activeTab === 'presets' && tabState.tabsEnabled.presets && (
              <AgentPresetsTab agentId={agentId} readOnly={readOnlyFlags.presets} />
            )}

          </div>
        </div>
      </AgentPane.Body>
    </AgentPane>
  );
}

export default AgentEditingView
