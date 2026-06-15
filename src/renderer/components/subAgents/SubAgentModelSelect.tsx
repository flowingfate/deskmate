import React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import { GroupedModelPicker, useModelDisplayLabel } from '@/components/chat/GroupedModelPicker'
import { Button } from '@/shadcn/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/shadcn/popover'

/**
 * Sub-agent 模型选择器。
 *
 * pi 迁移后复用 GroupedModelPicker（按 provider 分组、按 `${provider}::${modelId}`
 * 复合 key 存值），额外加一个 "Inherit parent model" 哨兵选项。哨兵选中时 value
 * 写回 INHERIT_MODEL_VALUE ("inherit")；其余情况写复合 key，与父 agent 的 model
 * 字段同 schema。
 */

interface SubAgentModelSelectProps {
  value: string
  onChange: (value: string) => void
}

const SubAgentModelSelect: React.FC<SubAgentModelSelectProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = React.useState(false)

  const selectedValue = value?.trim() || INHERIT_MODEL_VALUE
  const isInherit = selectedValue === INHERIT_MODEL_VALUE
  const { label: modelLabel } = useModelDisplayLabel(isInherit ? null : selectedValue)
  const selectedLabel = isInherit ? 'Inherit parent model' : modelLabel

  const handleSelect = (next: string) => {
    onChange(next)
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="model-button"
          title="Select AI Model"
        >
          <span className="model-name">{selectedLabel}</span>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={`opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto min-w-[var(--radix-popover-trigger-width)] max-w-80 max-h-[260px] overflow-y-auto overflow-x-hidden p-1"
        align="start"
        sideOffset={4}
      >
        <Button
          type="button"
          variant="ghost"
          className={`flex items-center w-full gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer transition-colors
            hover:bg-sc-accent hover:text-sc-accent-foreground
            ${isInherit ? 'bg-sc-accent/50' : ''}`}
          onClick={() => handleSelect(INHERIT_MODEL_VALUE)}
        >
          <Check
            size={14}
            strokeWidth={2}
            className={`shrink-0 ${isInherit ? 'opacity-100' : 'opacity-0'}`}
          />
          <div className="flex flex-col items-start gap-0.5 min-w-0">
            <span className="truncate text-sm">Inherit parent model</span>
            <div className="flex gap-1">
              <span className="badge default">Default</span>
            </div>
          </div>
        </Button>

        <GroupedModelPicker
          value={isInherit ? '' : selectedValue}
          onChange={handleSelect}
          variant="popover"
        />
      </PopoverContent>
    </Popover>
  )
}

export default SubAgentModelSelect
