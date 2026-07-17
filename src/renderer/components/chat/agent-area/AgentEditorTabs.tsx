import React from 'react'
import AgentBasicTab from '../agent-editor/AgentBasicTab'
import AgentDelegationTab from '../agent-editor/AgentDelegationTab'
import AgentKnowledgeBaseTab from '../agent-editor/AgentKnowledgeBaseTab'
import AgentMcpServersTab from '../agent-editor/AgentMcpServersTab'
import AgentPresetsTab from '../agent-editor/AgentPresetsTab'
import AgentSkillsTab from '../agent-editor/AgentSkillsTab'
import AgentSystemPromptTab from '../agent-editor/AgentSystemPromptTab'
import AgentToolsTab from '../agent-editor/AgentToolsTab'
import type { AgentConfig, AgentEditorTabName } from '../agent-editor/types'

interface AgentEditorTabsProps {
  agentId: string
  activeTab: AgentEditorTabName
  agentData: AgentConfig | undefined
  cachedData: Record<AgentEditorTabName, Partial<AgentConfig> | null>
  fieldErrors: Record<string, string>
  onDataChange: (tabName: AgentEditorTabName, data: Partial<AgentConfig>, hasChanges: boolean) => void
}

const AgentEditorTabs: React.FC<AgentEditorTabsProps> = ({
  agentId,
  activeTab,
  agentData,
  cachedData,
  fieldErrors,
  onDataChange,
}) => {
  if (activeTab === 'basic') {
    return (
      <AgentBasicTab
        key={`basic-${agentId}`}
        mode="update"
        agentId={agentId}
        agentData={agentData}
        onDataChange={onDataChange}
        cachedData={cachedData.basic}
        fieldErrors={fieldErrors}
      />
    )
  }

  if (activeTab === 'knowledge') {
    return (
      <AgentKnowledgeBaseTab
        key={`knowledge-${agentId}`}
        mode="update"
        agentId={agentId}
        agentData={agentData}
        onDataChange={onDataChange}
        cachedData={cachedData.knowledge}
        fieldErrors={fieldErrors}
      />
    )
  }

  if (activeTab === 'mcp') {
    return (
      <AgentMcpServersTab
        key={`mcp-${agentId}`}
        mode="update"
        agentId={agentId}
        agentData={agentData}
        onDataChange={onDataChange}
        cachedData={cachedData.mcp}
        fieldErrors={fieldErrors}
      />
    )
  }

  if (activeTab === 'tools') {
    return (
      <AgentToolsTab
        key={`tools-${agentId}`}
        mode="update"
        agentId={agentId}
        agentData={agentData}
        onDataChange={onDataChange}
        cachedData={cachedData.tools}
        fieldErrors={fieldErrors}
      />
    )
  }

  if (activeTab === 'skills') {
    return (
      <AgentSkillsTab
        key={`skills-${agentId}`}
        mode="update"
        agentId={agentId}
        agentData={agentData}
        onDataChange={onDataChange}
        cachedData={cachedData.skills}
        fieldErrors={fieldErrors}
      />
    )
  }

  if (activeTab === 'delegation') {
    return (
      <AgentDelegationTab
        key={`delegation-${agentId}`}
        mode="update"
        agentId={agentId}
        agentData={agentData}
        onDataChange={onDataChange}
        cachedData={cachedData.delegation}
        fieldErrors={fieldErrors}
      />
    )
  }

  if (activeTab === 'prompt') {
    return (
      <AgentSystemPromptTab
        key={`prompt-${agentId}`}
        mode="update"
        agentId={agentId}
        agentData={agentData}
        onDataChange={onDataChange}
        cachedData={cachedData.prompt}
        fieldErrors={fieldErrors}
      />
    )
  }

  return <AgentPresetsTab agentId={agentId} />
}

export default AgentEditorTabs
