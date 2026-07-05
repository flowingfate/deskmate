import React, { useMemo } from 'react'
import { Button } from '@/shadcn/button'
import { Badge } from '@/shadcn/badge'
import { Pencil, Users, Download, FolderOpen, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { SubAgentConfig } from '../../lib/userData/types'
import { useToast } from '../ui/ToastProvider'
import { subAgentApi } from '@/ipc/subAgent'
import { DeleteSubAgentDialogAtom } from './subAgentCommands.atom'
import { ApplySubAgentDialogAtom } from './ApplySubAgentToAgentsDialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shadcn/dropdown-menu'

interface SubAgentListItemProps {
  config: SubAgentConfig
  isSelected: boolean
  onClick: () => void
  parentMcpCount?: number
  parentSkillsCount?: number
}

const contextAccessLabels: Record<string, string> = {
  isolated: 'Isolated',
  parent_summary: 'Summary',
  full_history: 'Full History',
}

const SubAgentListItem: React.FC<SubAgentListItemProps> = ({
  config,
  isSelected,
  onClick,
  parentMcpCount = 0,
  parentSkillsCount = 0,
}) => {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  const mcpDisplay = useMemo(() => {
    const ownCount = config.mcpServers?.length || 0
    const inheritEnabled = config.inherit_mcp_servers !== false
    if (inheritEnabled && parentMcpCount > 0) {
      return `${ownCount + parentMcpCount} (${parentMcpCount} inherited)`
    }
    if (inheritEnabled && parentMcpCount === 0) {
      return `${ownCount} (+inherit)`
    }
    return `${ownCount}`
  }, [config, parentMcpCount])

  const skillsDisplay = useMemo(() => {
    const ownCount = config.skills?.length || 0
    const inheritEnabled = config.inherit_skills !== false
    if (inheritEnabled && parentSkillsCount > 0) {
      return `${ownCount + parentSkillsCount} (${parentSkillsCount} inherited)`
    }
    if (inheritEnabled && parentSkillsCount === 0) {
      return `${ownCount} (+inherit)`
    }
    return `${ownCount}`
  }, [config, parentSkillsCount])

  const handleEdit = () => {
    navigate(`/settings/sub-agents/edit/${encodeURIComponent(config.name)}`)
  }

  const requestDelete = DeleteSubAgentDialogAtom.useChange().requestDelete
  const applyToAgents = ApplySubAgentDialogAtom.useChange().setSubAgent

  const handleDelete = () => {
    void requestDelete(config.name)
  }

  const handleApplyToAgents = () => {
    applyToAgents(config.name)
  }

  const handleExportAsClaudeCode = async () => {
    try {
      const result = await subAgentApi.exportAsClaudeCode(config.name)
      if (!result.success || !result.data) {
        showError(result.error || 'Export failed')
        return
      }
      const blob = new Blob([result.data], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${config.name}.md`
      a.click()
      URL.revokeObjectURL(url)
      showSuccess(`Sub-agent "${config.name}" exported successfully`)
    } catch (error) {
      showError(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const handleOpenInExplorer = async () => {
    try {
      const result = await subAgentApi.openInExplorer(config.name)
      if (!result.success) {
        showError(result.error || 'Failed to open folder')
      }
    } catch (error) {
      showError(`Failed to open folder: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return (
    <div
      className={`group box-border flex flex-col gap-1.5 px-5 py-4 border border-black/12 rounded-xl cursor-pointer relative transition-[background,border] duration-200 ${isSelected ? 'bg-[#F8F4F1]' : 'bg-white hover:bg-[#F8F4F1]'}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{config.emoji}</span>
        <span className="flex-1 truncate text-sm font-[650] text-[#272320] [font-variation-settings:'opsz'_10.5]">{config.display_name}</span>
        <span className="inline-flex items-center justify-center gap-1 shrink-0 whitespace-nowrap px-2 py-1 rounded-lg bg-[rgba(224,158,102,0.3)] text-xs font-semibold leading-4 text-[#6B3900] [font-variation-settings:'opsz'_10.5]">v{config.version}</span>
        <div className="relative opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => e.stopPropagation()}
              >
                ⋮
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4}>
              <DropdownMenuItem onClick={handleEdit}>
                <Pencil size={16} strokeWidth={1.5} />
                <span>Edit</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleApplyToAgents}>
                <Users size={16} strokeWidth={1.5} />
                <span>Apply to Agents...</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExportAsClaudeCode}>
                <Download size={16} strokeWidth={1.5} />
                <span>Export as Claude Code Format</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenInExplorer}>
                <FolderOpen size={16} strokeWidth={1.5} />
                <span>Open in File Explorer</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-sc-destructive focus:text-sc-destructive"
                onClick={handleDelete}
              >
                <Trash2 size={16} strokeWidth={1.5} />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="m-0 text-[13px] leading-[1.4] text-[#6b7280] line-clamp-2">{config.description}</p>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[#9ca3af]">
        <span>MCP: {mcpDisplay}</span>
        <span className="text-[#d1d5db]">·</span>
        <span>Skills: {skillsDisplay}</span>
        <span className="text-[#d1d5db]">·</span>
        <span>Context: {contextAccessLabels[config.context_access] || config.context_access}</span>
      </div>
    </div>
  )
}

export default SubAgentListItem
