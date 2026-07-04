'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom'
import { Users, RefreshCw, Plus } from 'lucide-react'
import { Badge } from '@/shadcn/badge'
import { Button } from '@/shadcn/button'
import { useSubAgents, useSkills } from '../userData/userDataProvider'
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom'
import { useToast } from '../ui/ToastProvider'
import SettingsLayout from '../settings/SettingsLayout'
import SubAgentListItem from './SubAgentListItem'
import { AgentContextType } from '../../types/agentContextTypes'
import type { SubAgentConfig } from '../../lib/userData/types'
import { subAgentApi } from '@/ipc/subAgent'
import { log } from '@/log';
const logger = log.child({ mod: 'SubAgentsView' });

/**
 * SubAgentsView - Sub-agent management view in the Settings page
 *
 * Design reference: SkillsView.tsx
 * - Uses unified-header + sub-agents-content-view layout
 * - useOutletContext<AgentContextType>() to get SettingsPage handlers
 * - useSubAgents() to get global sub-agent data
 */
const SubAgentsView: React.FC = () => {
  const {
    onSubAgentsAddMenuToggle,
  } = useOutletContext<AgentContextType>()

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Data fetching (via useSubAgents hook, not direct IPC)
  const { subAgents, stats, isLoading } = useSubAgents()
  const mcpServers = useMcpRuntimeServers()
  const { skills } = useSkills()
  const { showSuccess, showError } = useToast()

  // Global MCP/skills counts — used as inherited counts for sub-agents
  const globalMcpCount = mcpServers?.length || 0
  const globalSkillsCount = skills?.length || 0

  // Local UI state
  const [selectedSubAgent, setSelectedSubAgent] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  // Hidden file input for "Import from Claude Code"
  const importFileInputRef = useRef<HTMLInputElement>(null)

  // Auto-select the first item when subAgents changes
  useEffect(() => {
    if (subAgents.length > 0 && !selectedSubAgent) {
      setSelectedSubAgent(subAgents[0].name)
    } else if (subAgents.length === 0) {
      setSelectedSubAgent(null)
    }
  }, [subAgents, selectedSubAgent])

  // 外部入口（AgentSubAgentsTab）通过 `?selected=<name>` 表达“进来并预选某 sub-agent”的意图。
  // 命中后清掉该 query（replace，不新增历史条目）。subAgents 首帧可能还在加载，此时不清 query，
  // 等数据到位再选中，避免意图丢失。放在自动选首项 effect 之后，故 selected 优先级更高。
  useEffect(() => {
    const target = searchParams.get('selected')
    if (!target || subAgents.length === 0) return
    if (subAgents.some((s) => s.name === target)) setSelectedSubAgent(target)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('selected')
        return next
      },
      { replace: true },
    )
  }, [searchParams, subAgents, setSearchParams])

  // Listen for refresh events (来源：内部 dispatch，仅传 subAgentName 用于自动选中；
  // 数据刷新由 subAgents.atom 通过 persist 通道自动完成，无需手动 refresh)
  useEffect(() => {
    const handleRefresh = (event: CustomEvent<{ subAgentName?: string } | null>) => {
      if (event.detail?.subAgentName) {
        setSelectedSubAgent(event.detail.subAgentName)
      }
    }

    window.addEventListener('subAgents:refreshList', handleRefresh as EventListener)
    return () => {
      window.removeEventListener('subAgents:refreshList', handleRefresh as EventListener)
    }
  }, [])

  // Listen for "Import from Claude Code" event (from SubAgentsAddMenuDropdown)
  useEffect(() => {
    const handleImport = () => {
      importFileInputRef.current?.click()
    }
    window.addEventListener('subAgents:importFromClaudeCode', handleImport)
    return () => {
      window.removeEventListener('subAgents:importFromClaudeCode', handleImport)
    }
  }, [])

  // Handle import after file selection
  const handleImportFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset the input so the same file can be re-selected if needed
    e.target.value = ''

    // Use Electron webUtils.getPathForFile() API to get file path (sandboxed renderer)
    let filePath: string | undefined
    if (window.electronAPI?.fs?.getPathForFile) {
      try {
        filePath = window.electronAPI.fs.getPathForFile(file)
      } catch (err) {
        logger.warn({ msg: "webUtils.getPathForFile failed:", err: err })
      }
    }
    // Fallback: try legacy file.path (non-sandboxed Electron)
    if (!filePath) {
      filePath = (file as File & { path?: string }).path
    }
    if (!filePath) {
      showError('Unable to get file path. Please try again.')
      return
    }

    try {
      const result = await subAgentApi.importFromFile(filePath)
      if (result.success && result.data) {
        showSuccess(`Sub-agent "${result.data.display_name || result.data.name}" imported successfully`)
        setTimeout(() => {
          if (result.data?.name) {
            setSelectedSubAgent(result.data.name)
          }
        }, 300)
      } else {
        showError(result.error || 'Import failed')
      }
    } catch (error) {
      showError(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [showSuccess, showError])

  // Manually trigger Sync from Disk (filesystem scan → profile index sync)
  const handleSyncFromDisk = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      const result = await subAgentApi.syncFromDisk()
      if (result.success) {
        showSuccess('Sub-agents synced from disk successfully')
      } else {
        showError(result.error || 'Sync failed')
      }
    } catch (error) {
      showError(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing, showSuccess, showError])

  // Handle add button click
  const handleAddClick = useCallback(
    (buttonElement: HTMLElement) => {
      if (onSubAgentsAddMenuToggle) {
        onSubAgentsAddMenuToggle(buttonElement)
      }
    },
    [onSubAgentsAddMenuToggle],
  )

  return (
    <SettingsLayout
      icon={<Users size={18} />}
      title="Sub-Agents"
      badges={
        <Badge variant="secondary" className="text-xs">
          available sub-agents: {stats.total}
        </Badge>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleSyncFromDisk}
            disabled={isSyncing}
            title="Sync from Disk"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => handleAddClick(e.currentTarget)}
            title="Add Sub-Agent"
          >
            <Plus size={14} />
          </Button>
        </>
      }
    >
      {/* Hidden file input for Import from Claude Code */}
      <input
        ref={importFileInputRef}
        type="file"
        accept=".md"
        style={{ display: 'none' }}
        onChange={handleImportFileChange}
      />

      {/* Content - based on SkillsContentView */}
      <div className="p-6 bg-white flex-1 min-h-0 flex flex-col box-border overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-10 px-5 gap-3 text-[#6c6c70] text-sm">
            <div className="w-6 h-6 rounded-full border-2 border-border border-t-accent animate-spin opacity-60" />
          </div>
        ) : subAgents.length === 0 ? (
          <div className="flex items-center justify-center w-full h-full min-h-[400px]">
            <div className="flex flex-col items-center justify-center gap-6 text-center max-w-[500px] p-10">
              <p className="m-0 text-base font-medium leading-6 text-[#6c6c70]">No sub-agents configured yet.</p>
              <p className="m-0 text-[13px] text-[#9c9c9c] leading-[1.5]">
                Sub-agents allow your agents to delegate specialized tasks to other configured agents.
              </p>
              <div className="flex gap-3 items-center">
                <Button
                  variant="outline"
                  onClick={() => navigate('/settings/sub-agents/new')}
                >
                  Create Custom
                </Button>
                <Button
                  variant="outline"
                  onClick={() => importFileInputRef.current?.click()}
                >
                  Import from AGENT.md (Claude Code)
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {subAgents.map(sa => (
              <SubAgentListItem
                key={sa.name}
                config={sa}
                isSelected={selectedSubAgent === sa.name}
                onClick={() => setSelectedSubAgent(sa.name)}
                parentMcpCount={globalMcpCount}
                parentSkillsCount={globalSkillsCount}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsLayout>
  )
}

export default SubAgentsView
