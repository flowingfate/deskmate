'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { BookMarked, MoreHorizontal, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utilities/utils'
import { Button } from '@/shadcn/button'
import { ScrollArea } from '@/shadcn/scroll-area'
import { SkillConfig } from '../../lib/userData/types'
import ListSearchBox from '../ui/ListSearchBox'

interface SkillListPanelProps {
  skills: SkillConfig[]
  selectedSkill: SkillConfig | null
  isLoading: boolean
  onSelectSkill: (skill: SkillConfig | null) => void
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void
}

// Skill card — 与 MCP ServerCard / ToolListView 行项风格一致(Tailwind + semantic tokens)
interface SkillCardProps {
  skill: SkillConfig
  isSelected: boolean
  onSelect: () => void
  onMenuClick: (e: React.MouseEvent) => void
}

const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  isSelected,
  onSelect,
  onMenuClick,
}) => {

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors',
        'hover:bg-sc-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring',
        isSelected && 'border-sc-border bg-sc-accent text-sc-accent-foreground',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
          isSelected
            ? 'bg-sc-primary text-sc-primary-foreground'
            : 'bg-sc-muted text-sc-muted-foreground group-hover:bg-sc-primary/10 group-hover:text-sc-foreground',
        )}
      >
        <BookMarked size={15} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'truncate text-sm font-medium text-sc-foreground',
              isSelected && 'font-semibold',
            )}
          >
            {skill.name}
          </span>
        </div>
        {skill.version && (
          <span className="text-xs text-sc-muted-foreground">v{skill.version}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onMenuClick}
      >
        <MoreHorizontal size={15} strokeWidth={1.5} />
      </Button>
    </div>
  )
}

const SkillListPanel: React.FC<SkillListPanelProps> = ({
  skills,
  selectedSkill,
  isLoading,
  onSelectSkill,
  onSkillMenuToggle,
}) => {
  // Search filter — hooks must be at top level, before any early returns
  const [searchQuery, setSearchQuery] = useState('')

  const filteredSkills = searchQuery
    ? skills.filter(s => s.name.includes(searchQuery))
    : skills

  // Stable identity for filtered list — catches same-length content changes
  const filteredIdentity = useMemo(
    () => filteredSkills.map(s => s.name).join('\0'),
    [filteredSkills]
  )

  // Keep selection in sync with filtered results (also handles initial selection)
  // Depend on selectedSkill?.name so external selection changes (e.g. SkillsView 的 ?selected= query) are caught
  useEffect(() => {
    if (filteredSkills.length === 0) {
      if (selectedSkill) {
        onSelectSkill(null)
      }
      return
    }
    if (!selectedSkill) {
      onSelectSkill(filteredSkills[0])
      return
    }
    const currentInFiltered = filteredSkills.some(s => s.name === selectedSkill.name)
    if (!currentInFiltered) {
      // External selection of an off-filter item — clear search to reveal it
      if (searchQuery && skills.some(s => s.name === selectedSkill.name)) {
        setSearchQuery('')
        return
      }
      onSelectSkill(filteredSkills[0])
    }
  }, [searchQuery, filteredIdentity, selectedSkill?.name])

  const handleMenuClick = (skill: SkillConfig, e: React.MouseEvent) => {
    e.stopPropagation()
    if (onSkillMenuToggle) {
      const buttonElement = e.currentTarget as HTMLElement
      onSkillMenuToggle(skill.name, buttonElement)
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Loading skills...</p>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-sc-muted text-sc-muted-foreground">
          <BookMarked className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-sc-foreground">No skills available</p>
          <p className="text-xs text-sc-muted-foreground">Add a skill to get started.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ListSearchBox
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search skills..."
      />
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-1.5">
          {filteredSkills.map((skill) => (
            <li key={skill.name}>
              <SkillCard
                skill={skill}
                isSelected={selectedSkill?.name === skill.name}
                onSelect={() => onSelectSkill(skill)}
                onMenuClick={(e) => handleMenuClick(skill, e)}
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

export default SkillListPanel
