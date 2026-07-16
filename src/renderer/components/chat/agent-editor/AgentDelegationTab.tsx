import React, { useCallback, useMemo } from 'react'
import { AlertTriangle, ExternalLink, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AgentRecord } from '@shared/persist/types'
import { Button } from '@/shadcn/button'
import { useAgents } from '@/states/agents.atom'
import { AgentAvatar } from '../../common/AgentAvatar'
import type { TabComponentProps } from './types'
import { setEquals, setFingerprint, useDirtyTracker } from './useDirtyTracker'

interface DelegateRowProps {
  agent: AgentRecord
  selected: boolean
  readOnly: boolean
  onToggle: (agentId: string) => void
  onOpen: (agentId: string) => void
}

const DelegateRow: React.FC<DelegateRowProps> = ({ agent, selected, readOnly, onToggle, onOpen }) => {
  const inputId = `delegate-${agent.id}`
  const description = agent.description?.trim() || 'No description provided.'

  return (
    <div className="flex items-start gap-3 rounded-lg border border-black/10 bg-surface-primary p-3">
      <input
        id={inputId}
        type="checkbox"
        checked={selected}
        disabled={readOnly}
        onChange={() => onToggle(agent.id)}
        className="mt-1 size-4 shrink-0 accent-sc-primary"
      />
      <AgentAvatar
        emoji={agent.emoji ?? ''}
        avatar={agent.avatar}
        name={agent.name}
        size="sm"
        version={agent.version}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block cursor-pointer text-sm font-medium text-content">
          {agent.name}
        </label>
        <p className="mt-0.5 text-[13px] leading-5 text-content-secondary">{description}</p>
        <p className="mt-1 truncate font-mono text-xs text-content-secondary" title={agent.id}>{agent.id}</p>
        <p className="mt-1 truncate text-xs text-content-secondary" title={agent.model}>{agent.model}</p>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="shrink-0"
        onClick={() => onOpen(agent.id)}
        title={`Open ${agent.name} settings`}
        aria-label={`Open ${agent.name} settings`}
      >
        <ExternalLink size={16} aria-hidden />
      </Button>
    </div>
  )
}

interface UnavailableDelegateRowProps {
  agentId: string
  readOnly: boolean
  onToggle: (agentId: string) => void
}

const UnavailableDelegateRow: React.FC<UnavailableDelegateRowProps> = ({ agentId, readOnly, onToggle }) => {
  const inputId = `delegate-${agentId}`

  return (
    <div className="flex items-start gap-3 rounded-lg border border-status-warning/40 bg-amber-400/10 p-3">
      <input
        id={inputId}
        type="checkbox"
        checked
        disabled={readOnly}
        onChange={() => onToggle(agentId)}
        className="mt-1 size-4 shrink-0 accent-sc-primary"
      />
      <AlertTriangle className="mt-0.5 shrink-0 text-status-warning" size={18} aria-hidden />
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block cursor-pointer text-sm font-medium text-content">{agentId}</label>
        <p className="mt-0.5 text-[13px] leading-5 text-content-secondary">
          Unavailable agent. Remove this selection or restore the agent to make it available again.
        </p>
      </div>
    </div>
  )
}

const AgentDelegationTab: React.FC<TabComponentProps> = ({
  agentData,
  cachedData,
  onDataChange,
  readOnly = false,
}) => {
  const navigate = useNavigate()
  const agents = useAgents()
  const currentAgentId = agentData?.id
  const candidates = useMemo(
    () => agents.filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  )
  const candidateIds = useMemo(() => new Set(candidates.map((agent) => agent.id)), [candidates])
  const baseline = useMemo(() => new Set(agentData?.delegates ?? []), [agentData?.delegates])
  const cached = useMemo(
    () => cachedData?.delegates === undefined ? null : new Set(cachedData.delegates),
    [cachedData?.delegates],
  )
  const { value: selectedIds, setValue: setSelectedIds } = useDirtyTracker<Set<string>>({
    tabName: 'delegation',
    ready: currentAgentId !== undefined,
    agentId: currentAgentId,
    baseline,
    cached,
    equals: setEquals,
    fingerprint: setFingerprint,
    toPayload: (value) => ({ delegates: Array.from(value) }),
    onDataChange,
  })
  const unavailableIds = useMemo(
    () => Array.from(selectedIds).filter((agentId) => !candidateIds.has(agentId)),
    [candidateIds, selectedIds],
  )
  const toggleDelegate = useCallback((agentId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [setSelectedIds])
  const openAgentSettings = useCallback((agentId: string) => {
    navigate(`/agent/${agentId}/settings/basic`)
  }, [navigate])

  if (!agentData) {
    return (
      <div className="flex h-full items-center justify-center p-5 text-sm text-content-secondary" aria-live="polite">
        Loading delegation configuration...
      </div>
    )
  }

  return (
    <div className="agent-tab">
      <div className="flex h-full flex-1 flex-col overflow-y-auto p-5 custom-scrollbar">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-content">Delegation</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-content-secondary">
              Select the active agents that {agentData.name} may delegate work to.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => navigate('/agent/creation')} className="gap-1.5">
            <Plus size={16} aria-hidden />
            Create Agent
          </Button>
        </div>

        {unavailableIds.length > 0 && (
          <section aria-labelledby="unavailable-delegates-heading" className="mb-5">
            <h3 id="unavailable-delegates-heading" className="mb-2 text-sm font-medium text-content">Unavailable selections</h3>
            <div className="flex flex-col gap-2">
              {unavailableIds.map((agentId) => (
                <UnavailableDelegateRow
                  key={agentId}
                  agentId={agentId}
                  readOnly={readOnly}
                  onToggle={toggleDelegate}
                />
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="available-delegates-heading">
          <h3 id="available-delegates-heading" className="mb-2 text-sm font-medium text-content">Available agents</h3>
          {candidates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-black/15 px-4 py-5 text-sm text-content-secondary">
              No other active agents are available. Create an agent to enable delegation.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {candidates.map((agent) => (
                <DelegateRow
                  key={agent.id}
                  agent={agent}
                  selected={selectedIds.has(agent.id)}
                  readOnly={readOnly}
                  onToggle={toggleDelegate}
                  onOpen={openAgentSettings}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default AgentDelegationTab
