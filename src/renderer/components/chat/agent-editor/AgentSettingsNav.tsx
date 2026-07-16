import React from 'react'
import { User, BookOpen, Cable, Wrench, BookMarked, Network, FileText, Sparkles, Loader2, Save, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utilities/utils'
import { Button } from '@/shadcn/button'
import { Badge } from '@/shadcn/badge'
import { AgentEditorTabName } from './types'

interface NavItem {
  key: AgentEditorTabName
  label: string
  icon: LucideIcon
}

// 数据驱动的 tab 元数据 —— 图标复用各 tab 自身使用的 Lucide 图标，保持视觉一致。
const NAV_ITEMS: readonly NavItem[] = [
  { key: 'basic', label: 'Basic', icon: User },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { key: 'mcp', label: 'MCP Servers', icon: Cable },
  { key: 'tools', label: 'Tools', icon: Wrench },
  { key: 'skills', label: 'Skills', icon: BookMarked },
  { key: 'delegation', label: 'Delegation', icon: Network },
  { key: 'prompt', label: 'System Prompt', icon: FileText },
  { key: 'presets', label: 'Quick Prompts', icon: Sparkles },
]

interface AgentSettingsNavProps {
  activeTab: AgentEditorTabName
  pendingChanges: Record<AgentEditorTabName, boolean>
  onSwitch: (tab: AgentEditorTabName) => void
  onSaveAll: () => void
  isLoading: boolean
  canSaveAll: boolean
  pendingCount: number
}

/**
 * AgentSettingsNav —— Agent 设置页左侧导航。
 *
 * 视觉对齐 settings 侧栏 `NavItem`（中性配色）：active 用 shadcn `secondary`
 * 浅灰底 + medium 字重，inactive 用 ghost + muted 文字。未保存改动以右侧小圆点提示。
 */
const AgentSettingsNav: React.FC<AgentSettingsNavProps> = ({
  activeTab,
  pendingChanges,
  onSwitch,
  onSaveAll,
  isLoading,
  canSaveAll,
  pendingCount,
}) => {
  return (
    <div className="w-47 min-w-47 shrink-0 px-2 py-2.5 border-r border-black/7 flex flex-col gap-2 overflow-y-hidden">
      <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto box-border" aria-label="Agent settings sections">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key
          return (
            <Button
              key={key}
              variant={isActive ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start gap-2.5 px-2.5 font-normal"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSwitch(key)}
            >
              <Icon
                size={16}
                strokeWidth={1.75}
                className={cn('shrink-0', isActive ? 'text-sc-foreground' : 'text-sc-muted-foreground')}
                aria-hidden
              />
              <span className={cn('flex-1 truncate text-left', isActive ? 'font-medium' : 'text-sc-muted-foreground')}>
                {label}
              </span>
              {pendingChanges[key] && (
                <span className="size-1.5 shrink-0 rounded-full bg-sc-primary" aria-label="Unsaved changes" />
              )}
            </Button>
          )
        })}
      </nav>
      <div className="shrink-0 pb-1">
        <Button
          onClick={onSaveAll}
          disabled={isLoading || !canSaveAll}
          title={isLoading ? 'Saving...' : canSaveAll ? 'Save All Changes' : 'No Changes to Save'}
          size="sm"
          variant={canSaveAll ? 'default' : 'outline'}
          className="w-full gap-1.5"
        >
          {isLoading
            ? <Loader2 size={14} className="animate-spin" />
            : <Save size={14} strokeWidth={1.75} />}
          {isLoading ? 'Saving...' : 'Save'}
          {!isLoading && pendingCount > 0 && (
            <Badge className="ml-0.5 h-4 px-1.5 py-0 text-[11px] font-semibold border-transparent bg-white/25 text-white">
              {pendingCount}
            </Badge>
          )}
        </Button>
      </div>
    </div>
  )
}

export default AgentSettingsNav
