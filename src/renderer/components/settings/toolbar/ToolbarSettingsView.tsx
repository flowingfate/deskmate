'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Settings } from 'lucide-react'
import SettingsLayout from '../SettingsLayout'
import ToolbarSettingsContentView from './ToolbarSettingsContentView'
import { getAgents, listenAgents } from '@/states/agents.atom'
import { toolbarApi } from '@/ipc/toolbar'

// Type definitions
interface ToolBarSettings {
  enabled: boolean
  alwaysOnTop: boolean
  autoHide: boolean
  shortcut: string
  visibleAgents?: string[]
}

interface AgentEnvelope {
  agent_id: string
  agent?: {
    name: string
    emoji: string
  }
}

const ToolbarSettingsView: React.FC = () => {
  // State management
  const [settings, setSettings] = useState<ToolBarSettings>({
    enabled: false,
    alwaysOnTop: false,
    autoHide: true,
    shortcut: 'CommandOrControl+Shift+Space',
    visibleAgents: [],
  })

  const [agents, setAgents] = useState<AgentEnvelope[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load settings and agents on component mount
  useEffect(() => {
    loadSettings()
    loadAgents()
    // 订阅 agents.atom 变化（agent 新增/删除/更名）
    return listenAgents(() => loadAgents())
  }, [])

  /**
   * Load current ToolBar settings from the backend
   */
  const loadSettings = async () => {
    try {
      const response = await toolbarApi.getSettings()
      if (response?.success && response.data) {
        setSettings(response.data)
      } else {
        setError(
          'Failed to load ToolBar settings: ' +
            (response?.error || 'Unknown error'),
        )
      }
    } catch (err) {
      setError(
        'Failed to load ToolBar settings: ' +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  /**
   * Load all available agents for visibility configuration（从 agents.atom 派生）
   */
  const loadAgents = () => {
    setLoading(true)
    try {
      const list: AgentEnvelope[] = getAgents().map((v) => ({
        agent_id: v.id,
        agent: { name: v.name, emoji: v.emoji ?? '' },
      }))
      setAgents(list)
    } catch (err) {
      setError(
        'Failed to load agents: ' +
          (err instanceof Error ? err.message : String(err)),
      )
    } finally {
      setLoading(false)
    }
  }

  /**
   * Save settings directly to the backend (auto-save on change)
   */
  const saveSettings = useCallback(async (newSettings: ToolBarSettings) => {
    try {
      setError(null)
      const response = await toolbarApi.updateSettings(newSettings)
      if (!response?.success) {
        setError('Failed to save settings: ' + (response?.error || 'Unknown error'))
      }
    } catch (err) {
      setError(
        'Failed to save settings: ' +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }, [])

  /**
   * Handle settings change - auto-save on change
   */
  const handleSettingsChange = useCallback(async (newSettings: ToolBarSettings) => {
    setSettings(newSettings)
    await saveSettings(newSettings)
  }, [saveSettings])

  /**
   * Toggle agent visibility in ToolBar - auto-save on change
   */
  const handleToggleAgent = useCallback(async (agentId: string) => {
    const visibleAgents = settings.visibleAgents || []
    const isVisible = visibleAgents.includes(agentId)

    let newVisibleAgents: string[]
    if (isVisible) {
      // Remove agent from visible list
      newVisibleAgents = visibleAgents.filter((id) => id !== agentId)
    } else {
      // Add agent to visible list
      newVisibleAgents = [...visibleAgents, agentId]
    }

    const newSettings = {
      ...settings,
      visibleAgents: newVisibleAgents,
    }

    setSettings(newSettings)
    await saveSettings(newSettings)
  }, [settings, saveSettings])

  /**
   * Handle shortcut change from ShortcutRecorder - direct save
   */
  const handleShortcutChange = async (newShortcut: string) => {
    if (!newShortcut.trim()) return

    setSettings({
      ...settings,
      shortcut: newShortcut,
    })
    await toolbarApi.updateShortcut(newShortcut)
  }

  /**
   * Check if all agents are visible
   */
  const areAllAgentsVisible = useCallback(() => {
    if (!settings.visibleAgents || settings.visibleAgents.length === 0) {
      return false // Empty array means no agents are selected
    }
    // Check if all available agents are in the visible list
    return agents.every((agent) =>
      settings.visibleAgents?.includes(agent.agent_id),
    )
  }, [settings.visibleAgents, agents])

  /**
   * Toggle all agents visibility - auto-save on change
   */
  const handleToggleAllAgents = useCallback(async () => {
    let newSettings: ToolBarSettings

    if (areAllAgentsVisible()) {
      // Hide all agents (empty array)
      newSettings = {
        ...settings,
        visibleAgents: [],
      }
    } else {
      // Show all agents (include all chat_ids)
      newSettings = {
        ...settings,
        visibleAgents: agents.map((agent) => agent.agent_id),
      }
    }

    setSettings(newSettings)
    await saveSettings(newSettings)
  }, [settings, agents, areAllAgentsVisible, saveSettings])

  return (
    <SettingsLayout icon={<Settings size={18} />} title="Toolbar">
      <ToolbarSettingsContentView
        settings={settings}
        agents={agents}
        loading={loading}
        error={error}
        onSettingsChange={handleSettingsChange}
        onShortcutChange={handleShortcutChange}
        onToggleAgent={handleToggleAgent}
        onToggleAllAgents={handleToggleAllAgents}
        areAllAgentsVisible={areAllAgentsVisible}
      />
    </SettingsLayout>
  )
}

export default ToolbarSettingsView
