'use client'

import React from 'react'
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'
import { Button } from '@/shadcn/button'
import { Badge } from '@/shadcn/badge'
import { formatFileSize } from '../../../lib/utilities/contentUtils'
import type { RuntimeStorageOverview, StorageOverview } from '@shared/ipc/persist'
import { StatCell } from './StoragePrimitives'
import AgentGroupCard from './AgentGroupCard'
import RuntimeStorageCard from './RuntimeStorageCard'
import SharedDataCard from './SharedDataCard'

interface PersistSettingsContentViewProps {
  overview: StorageOverview | null
  runtimeOverview: RuntimeStorageOverview | null
  error: string | null
  loading: boolean
  runtimeLoading: boolean
  onReveal: (absPath: string) => void
  onRefresh: () => void
}

const PersistSettingsContentView: React.FC<PersistSettingsContentViewProps> = ({
  overview,
  runtimeOverview,
  error,
  loading,
  runtimeLoading,
  onReveal,
  onRefresh,
}) => {
  return (
    <div className="flex flex-col p-6 bg-(--bg-primary) h-full overflow-auto" data-dbg="persist-settings">
      <div className="max-w-4xl mx-auto w-full">
        {error && (
          <div className="mb-4 p-4 border border-[#fecaca] rounded-xl bg-[#fef2f2] text-[#b91c1c]">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-(--status-error-light) shrink-0" />
              <span className="font-medium">Error:</span>
            </div>
            <p className="mt-1 text-sm leading-5">{error}</p>
          </div>
        )}

        <div className="space-y-6 px-6 pb-6">
          <p className="text-sm text-content-secondary leading-relaxed">
            Everything you create in this app is stored locally on this device — nothing here is uploaded.
            Data is organized around your agents: each agent owns its conversations, scheduled runs, and
            knowledge base. Shared resources are listed separately below.
          </p>

          {/* Prominent safety warning — these files are load-bearing. */}
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
          >
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900 leading-snug">
                Do not edit or delete these files manually.
              </p>
              <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                Unless you know exactly what you are doing, changing or removing anything in these folders can
                corrupt your data and stop the app from running correctly. This page is for viewing only — use
                the app's own controls to manage agents, conversations, and settings.
              </p>
            </div>
          </div>

          {!overview && loading && (
            <div className="flex items-center justify-center py-16 text-content-secondary text-sm gap-2">
              <RefreshCw size={16} className="animate-spin" />
              Scanning local data…
            </div>
          )}

          {overview && (
            <>
              {/* Location + total */}
              <div className="bg-white rounded-md p-4 border border-black/7 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <label className="text-base font-medium text-content">Storage Location</label>
                      <Badge variant="secondary" className="text-[11px]">
                        {overview.profileKind === 'signed_in' ? 'Signed in' : 'Guest'}
                      </Badge>
                    </div>
                    <p
                      className="mt-1 text-xs text-content-secondary font-mono break-all leading-relaxed"
                      title={overview.dataRoot}
                    >
                      {overview.dataRoot}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-2xl font-semibold text-content tabular-nums leading-none">
                      {formatFileSize(overview.totalBytes)}
                    </div>
                    <div className="mt-1 text-xs text-content-secondary">on disk</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => onReveal(overview.dataRoot)}>
                    <FolderOpen size={14} className="mr-1.5" />
                    Open Data Folder
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading || runtimeLoading}>
                    <RefreshCw size={14} className={'mr-1.5 ' + (loading || runtimeLoading ? 'animate-spin' : '')} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Counts */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                <StatCell label="Agents" value={overview.stats.agents} />
                <StatCell label="Conversations" value={overview.stats.conversations} />
                <StatCell label="Scheduled Runs" value={overview.stats.scheduledRuns} />
                <StatCell label="Skills" value={overview.stats.skills} />
                <StatCell label="MCP Servers" value={overview.stats.mcpServers} />
                <StatCell label="Archived" value={overview.stats.archivedAgents} />
              </div>

              {/* By Agent */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-base font-medium text-content">By Agent</label>
                  <span className="text-xs text-content-secondary tabular-nums">
                    {formatFileSize(overview.agentsTotalBytes)} across {overview.agents.length}{' '}
                    {overview.agents.length === 1 ? 'agent' : 'agents'}
                  </span>
                </div>
                {overview.agents.length === 0 ? (
                  <div className="bg-white rounded-md p-6 border border-black/7 text-center text-sm text-content-secondary">
                    No agents yet. Conversations and knowledge appear here once you create an agent.
                  </div>
                ) : (
                  overview.agents.map((group) => (
                    <AgentGroupCard key={group.agentId} group={group} onReveal={onReveal} />
                  ))
                )}
              </div>

              {/* Shared Data */}
              <SharedDataCard shared={overview.shared} onReveal={onReveal} />

              <RuntimeStorageCard
                overview={runtimeOverview}
                loading={runtimeLoading}
                onReveal={onReveal}
              />

              <p className="text-xs text-content-secondary leading-relaxed">
                The <span className="font-medium">Search Index</span> is a derived cache rebuilt automatically from
                your conversations — deleting it never loses data. Generated at{' '}
                {new Date(overview.generatedAt).toLocaleTimeString()}.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default PersistSettingsContentView
