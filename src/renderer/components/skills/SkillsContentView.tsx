'use client'

import React from 'react'
import { BookMarked } from 'lucide-react'
import { Button } from '@/shadcn/button'
import SkillListPanel from './SkillListPanel'
import SkillViewPanel from './SkillViewPanel'
import { SkillConfig } from '../../lib/userData/types'
import SkillsAddButton from './SkillsAddButton'

interface SkillsContentViewProps {
  skills: SkillConfig[]
  selectedSkill: SkillConfig | null
  isLoading: boolean
  onSelectSkill: (skill: SkillConfig | null) => void
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void
}

const SkillsContentView: React.FC<SkillsContentViewProps> = ({
  skills,
  selectedSkill,
  isLoading,
  onSelectSkill,
  onSkillMenuToggle
}) => {

  // Show empty state when there are no Skills and not loading
  if (!isLoading && skills.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="flex max-w-md flex-col items-center gap-5 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-sc-muted text-sc-muted-foreground">
            <BookMarked className="size-6" />
          </span>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-sc-foreground">No skills yet</p>
            <p className="text-sm text-sc-muted-foreground">
              Add one from a .zip / .skill file or a folder to get started.
            </p>
          </div>
          <SkillsAddButton align="center">
            <Button variant="outline" size="sm">
              Add from Device
            </Button>
          </SkillsAddButton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left: Skill list */}
      <div className="p-3 flex w-66 shrink-0 flex-col overflow-hidden border-r border-sc-border">
        <SkillListPanel
          skills={skills}
          selectedSkill={selectedSkill}
          isLoading={isLoading}
          onSelectSkill={onSelectSkill}
          onSkillMenuToggle={onSkillMenuToggle}
        />
      </div>

      {/* Right: Skill file explorer/viewer */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <SkillViewPanel skill={selectedSkill} />
      </div>
    </div>
  )
}

export default SkillsContentView
