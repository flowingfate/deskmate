'use client'

import React from 'react'
import { BookMarked } from 'lucide-react'
import { Button } from '@/shadcn/button'
import { Card } from '@/shadcn/card'
import SkillListPanel from './SkillListPanel'
import SkillViewPanel from './SkillViewPanel'
import { SkillConfig } from '../../lib/userData/types'

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
  // Trigger add Skill event
  const handleAddFromDeviceArtifact = () => {
    window.dispatchEvent(new CustomEvent('skills:addFromDeviceArtifact'))
  }

  const handleAddFromDeviceFolder = () => {
    window.dispatchEvent(new CustomEvent('skills:addFromDeviceFolder'))
  }

  // Show empty state when there are no Skills and not loading
  if (!isLoading && skills.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-3">
        <Card className="flex max-w-md flex-col items-center gap-5 p-10 text-center shadow-none">
          <BookMarked className="size-10 text-sc-muted-foreground opacity-40" />
          <p className="text-sm text-sc-muted-foreground">
            No skills available. Add one from a .zip/.skill file or a folder.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleAddFromDeviceArtifact}>
              Add from Device (.zip/.skill)
            </Button>
            <Button variant="outline" size="sm" onClick={handleAddFromDeviceFolder}>
              Add from Device (folder)
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left: Skill list */}
      <div className="p-3 flex w-66 shrink-0 flex-col overflow-hidden border-r border-black/7">
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
