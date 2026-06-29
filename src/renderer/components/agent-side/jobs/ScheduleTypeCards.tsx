import React from 'react'
import { Button } from '@/shadcn/button'
import type { OverlayScheduleMode } from './scheduleForm'

interface ScheduleTypeCardsProps {
  mode: OverlayScheduleMode
  onChange: (mode: OverlayScheduleMode) => void
}
const cardBase =
  'flex-1 min-w-0 flex flex-col gap-1 px-4 py-3 transition-all border h-auto items-center text-center'

/** "One-Time" vs "Recurring" 双卡选择器。纯展示，无内部状态。 */
const ScheduleTypeCards: React.FC<ScheduleTypeCardsProps> = ({ mode, onChange }) => (
  <div>
    <div className="text-sm font-bold text-gray-900 mb-2">Schedule Type</div>
    <div className="flex gap-2 rounded-lg bg-gray-50 p-1.5">
      <Button
        variant="ghost"
        type="button"
        className={`${cardBase} ${mode === 'once' ? 'border-gray-200 bg-white shadow-sm' : 'border-transparent bg-transparent'}`}
        onClick={() => onChange('once')}
      >
        <span className="text-sm font-semibold text-gray-900">One-Time Schedule</span>
        <span className="text-xs text-gray-500">Run once at a specific date and time.</span>
      </Button>
      <Button
        variant="ghost"
        type="button"
        className={`${cardBase} ${mode === 'recurring' ? 'border-gray-200 bg-white shadow-sm' : 'border-transparent bg-transparent'}`}
        onClick={() => onChange('recurring')}
      >
        <span className="text-sm font-semibold text-gray-900">Recurring Schedule</span>
        <span className="text-xs text-gray-500">Repeat daily, weekly, monthly, or every N intervals.</span>
      </Button>
    </div>
  </div>
)

export default ScheduleTypeCards
