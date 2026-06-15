'use client'

import React from 'react'
import { EyeOff } from 'lucide-react'
import { Button } from '@/shadcn/button'
import { Switch } from '@/shadcn/switch'
import { Checkbox } from '@/shadcn/checkbox'
import ShortcutRecorder from '../../ui/ShortcutRecorder'
import { AgentAvatar } from '../../common/AgentAvatar'
import { PSEUDO_AGENT_SEARCH_GOOGLE as SEARCH_AGENT_GOOGLE, PSEUDO_AGENT_SEARCH_BING as SEARCH_AGENT_BING } from '@shared/constants/pseudoAgents'
interface ToolBarSettings {
  enabled: boolean;
  alwaysOnTop: boolean;
  autoHide: boolean;
  shortcut: string;
  visibleAgents?: string[];
}

interface AgentEnvelope {
  agent_id: string
  agent?: {
    name: string
    emoji: string
    avatar?: string
    version?: string
  }
}

interface ToolbarSettingsContentViewProps {
  settings: ToolBarSettings
  agents: AgentEnvelope[]
  loading: boolean
  error: string | null
  onSettingsChange: (settings: ToolBarSettings) => void
  onShortcutChange: (shortcut: string) => void
  onToggleAgent: (agentId: string) => void
  onToggleAllAgents: () => void
  areAllAgentsVisible: () => boolean
}

const ToolbarSettingsContentView: React.FC<ToolbarSettingsContentViewProps> = ({
  settings,
  agents,
  loading,
  error,
  onSettingsChange,
  onShortcutChange,
  onToggleAgent,
  onToggleAllAgents,
  areAllAgentsVisible,
}) => {
  // Add Search Agent to the list
  const googleSearchAgent: AgentEnvelope = {
    agent_id: SEARCH_AGENT_GOOGLE,
    agent: {
      name: 'Google Search',
      emoji: '🔍',
    },
  };

  const bingSearchAgent: AgentEnvelope = {
    agent_id: SEARCH_AGENT_BING,
    agent: {
      name: 'Bing Search',
      emoji: '🔍',
    },
  };

  const displayAgents = [googleSearchAgent, bingSearchAgent, ...agents];

  return (
    <div className="content-view-container">
      <div className="toolbar-settings-content">
        {/* Error Message */}
        {error && (
          <div className="toolbar-settings-error glass-surface">
            <div className="message-header">
              <div className="message-indicator"></div>
              <span className="message-label">Error:</span>
            </div>
            <p className="message-text">{error}</p>
          </div>
        )}

        {/* Settings Form */}
        <div className="toolbar-settings-form">
          <div className="toolbar-settings-form-inner">
            {/* Global Settings */}
            <div className="toolbar-settings-card">
              {/* Enable ToolBar */}
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">Enable ToolBar</label>
                </div>
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(checked) =>
                    onSettingsChange({
                      ...settings,
                      enabled: checked,
                    })
                  }
                />
              </div>

              {/* Always On Top */}
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">Always On Top</label>
                </div>
                <Switch
                  checked={settings.alwaysOnTop}
                  onCheckedChange={(checked) =>
                    onSettingsChange({
                      ...settings,
                      alwaysOnTop: checked,
                    })
                  }
                />
              </div>

              {/* Auto Hide */}
              <div className="toolbar-setting-item">
                <div className="setting-label-container">
                  <label className="setting-label">Auto Hide</label>
                </div>
                <Switch
                  checked={settings.autoHide}
                  onCheckedChange={(checked) =>
                    onSettingsChange({
                      ...settings,
                      autoHide: checked,
                    })
                  }
                />
              </div>
            </div>

            {/* Shortcut Configuration */}
            <div className="toolbar-settings-card toolbar-shortcut-section">
              <label className="shortcut-label">Shortcut</label>
              <ShortcutRecorder
                value={settings.shortcut}
                onChange={onShortcutChange}
              />
            </div>

            {/* Agents Visible on Toolbar */}
            <div className="toolbar-settings-card">
              <div className="toolbar-agent-visibility-header">
                <h2 className="toolbar-agent-visibility-title">
                  Agents Visible on Toolbar
                </h2>
                <Button variant="ghost" size="sm" onClick={onToggleAllAgents}>
                  {areAllAgentsVisible() ? 'Select None' : 'Select All'}
                </Button>
              </div>

              {loading ? (
                <div className="toolbar-loading-state">
                  <div className="toolbar-loading-spinner"></div>
                  <p className="loading-text">Loading agents...</p>
                </div>
              ) : (
                <div className="toolbar-agent-list custom-scrollbar">
                  {displayAgents.map((agent) => {
                    const isVisible =
                      settings.visibleAgents?.includes(agent.agent_id) ?? false;
                    return (
                      <div key={agent.agent_id} className="toolbar-agent-item">
                        <div className="agent-info">
                          <div className="agent-avatar">
                            <AgentAvatar
                              emoji={agent.agent?.emoji}
                              avatar={agent.agent?.avatar}
                              name={agent.agent?.name}
                              size="sm"
                              version={agent.agent?.version}
                            />
                          </div>
                          <span className="agent-name">
                            {agent.agent?.name || 'Unknown Agent'}
                          </span>
                        </div>
                        <Checkbox
                          checked={isVisible}
                          onCheckedChange={() => onToggleAgent(agent.agent_id)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};;

export default ToolbarSettingsContentView
