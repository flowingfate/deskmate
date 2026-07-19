import React from 'react'
import { useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/shadcn/button'
import AgentPane from '@/pages/layout/agent/agent-pane'
import { AgentAvatar } from '../../common/AgentAvatar'
import ErrorHandler from '../agent-editor/ErrorHandler'
import AgentSettingsNav from '../agent-editor/AgentSettingsNav'
import AgentEditorTabs from './AgentEditorTabs'
import { useAgentEditorState } from './useAgentEditorState'

const AgentEditingView: React.FC = () => {
  const { agentId, '*': tabParam } = useParams<{ agentId: string; '*': string }>()
  const {
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
  } = useAgentEditorState(agentId, tabParam)

  if (!agentId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p>No agent selected. Please select an agent from the left navigation.</p>
        <Button onClick={handleBack}>Go to Chat</Button>
      </div>
    )
  }

  return (
    <AgentPane className="flex h-full w-full flex-col bg-surface-primary">
      <AgentPane.Head>
        <div className="flex min-w-0 items-center gap-2.5">
          <Button variant="ghost" size="icon-sm" onClick={handleBack} title="Back">
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
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-semibold">{agentData?.name ?? 'Agent'}</span>
            <span className="shrink-0 text-xs opacity-50">Settings</span>
          </div>
        </div>
      </AgentPane.Head>

      <AgentPane.Body>
        <div className="flex h-full min-h-0 flex-1 overflow-hidden">
          {error && (
            <div className="shrink-0 px-6">
              <ErrorHandler error={error} onDismiss={handleClearError} />
            </div>
          )}

          <AgentSettingsNav
            activeTab={activeTab}
            pendingChanges={pendingChanges}
            onSwitch={handleTabSwitch}
            onSaveAll={handleSaveAll}
            isLoading={isLoading}
            canSaveAll={canSaveAll}
            pendingCount={pendingCount}
          />

          <div className="relative min-w-0 flex-1 overflow-hidden bg-white/95">
            {isLoading && (
              <div className="absolute inset-0 z-100 flex flex-col items-center justify-center gap-3 bg-white/70 backdrop-blur-xs">
                <Loader2 className="animate-spin text-accent" size={20} strokeWidth={2} />
                <span className="text-sm font-medium text-content-secondary">Saving...</span>
              </div>
            )}
            <AgentEditorTabs
              agentId={agentId}
              activeTab={activeTab}
              agentData={agentData}
              cachedData={tabChangesCache}
              fieldErrors={fieldErrors}
              onDataChange={handleTabDataChange}
            />
          </div>
        </div>
      </AgentPane.Body>
    </AgentPane>
  )
}

export default AgentEditingView
