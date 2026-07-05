import React from 'react'
import { Check } from 'lucide-react'
import { INHERIT_MODEL_VALUE } from '@shared/constants/subAgent'
import { ModelSelectPopover } from '@/components/chat/ModelSelectPopover'
import { Button } from '@/shadcn/button'

/**
 * Sub-agent 模型选择器。
 *
 * 复用 ModelSelectPopover（ghost 外观）+ GroupedModelPicker（按 provider 分组、按
 * `${provider}::${modelId}` 复合 key 存值），额外加一个 "Inherit parent model" 哨兵项。
 * 哨兵选中时 value 写回 INHERIT_MODEL_VALUE ("inherit")；其余情况写复合 key，与父
 * agent 的 model 字段同 schema。
 */

interface SubAgentModelSelectProps {
  value: string
  onChange: (value: string) => void
}

const SubAgentModelSelect: React.FC<SubAgentModelSelectProps> = ({ value, onChange }) => {
  const selectedValue = value?.trim() || INHERIT_MODEL_VALUE
  const isInherit = selectedValue === INHERIT_MODEL_VALUE

  return (
    <ModelSelectPopover
      value={selectedValue}
      pickerValue={isInherit ? '' : selectedValue}
      invalidOverride={false}
      onChange={onChange}
      labelOverride={isInherit ? 'Inherit parent model' : undefined}
      contentClassName="max-w-80 max-h-65"
      header={(select) => (
        <Button
          type="button"
          variant="ghost"
          className={`flex items-center justify-start w-full gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer transition-colors
            hover:bg-sc-accent hover:text-sc-accent-foreground
            ${isInherit ? 'bg-sc-accent/50' : ''}`}
          onClick={() => select(INHERIT_MODEL_VALUE)}
        >
          <Check
            size={14}
            strokeWidth={2}
            className={`shrink-0 ${isInherit ? 'opacity-100' : 'opacity-0'}`}
          />
          <div className="flex flex-col items-start gap-0.5 min-w-0">
            <span className="truncate text-sm">Default: Inherit parent model</span>
          </div>
        </Button>
      )}
    />
  )
}

export default SubAgentModelSelect
