import React, { useState } from 'react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shadcn/select'
import { Button } from '@/shadcn/button'
import { Input } from '@/shadcn/input'
import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions'
import {
  MULTI_DAILY_TIME_REGEX,
  normalizeMultiDailyTimes,
  recurringPresetLabel,
  weekDayOptions,
  type RecurringPreset,
} from './scheduleForm'

interface RecurringScheduleEditorProps {
  preset: RecurringPreset
  recurringTime: string
  multiDailyTimes: string[]
  everyNValue: number
  weeklyDay: number
  monthlyDay: number
  cronExpression?: string
  validationMessage: string | null
  onPresetChange: (preset: RecurringPreset) => void
  onTimeChange: (time: string) => void
  onMultiDailyTimesChange: (times: string[]) => void
  onEveryNChange: (value: number) => void
  onWeeklyDayChange: (value: number) => void
  onMonthlyDayChange: (value: number) => void
}

const sectionTitle = 'text-sm font-bold text-gray-900 mb-2'

/** 循环计划编辑器：preset 选择 + 各模式参数 + cron 预览。多时间草稿状态内部自管。 */
const RecurringScheduleEditor: React.FC<RecurringScheduleEditorProps> = ({
  preset,
  recurringTime,
  multiDailyTimes,
  everyNValue,
  weeklyDay,
  monthlyDay,
  cronExpression,
  validationMessage,
  onPresetChange,
  onTimeChange,
  onMultiDailyTimesChange,
  onEveryNChange,
  onWeeklyDayChange,
  onMonthlyDayChange,
}) => {
  const [draft, setDraft] = useState('')
  const [draftMessage, setDraftMessage] = useState<string | null>(null)

  const handleAddTime = () => {
    if (!draft) {
      setDraftMessage('Pick a time before adding it.')
      return
    }
    if (!MULTI_DAILY_TIME_REGEX.test(draft)) {
      setDraftMessage('Select a valid time in HH:mm format.')
      return
    }
    if (multiDailyTimes.includes(draft)) {
      setDraftMessage(`${draft} is already in the list.`)
      return
    }
    onMultiDailyTimesChange(normalizeMultiDailyTimes([...multiDailyTimes, draft]))
    setDraft('')
    setDraftMessage(null)
  }

  const handleRemoveTime = (timeToRemove: string) => {
    onMultiDailyTimesChange(multiDailyTimes.filter((time) => time !== timeToRemove))
    setDraftMessage(null)
  }

  return (
    <>
      <div>
        <div className={sectionTitle}>Recurring Pattern</div>
        <div className="grid grid-cols-4 gap-1.5 rounded-lg bg-gray-50 p-1.5">
          {(Object.keys(recurringPresetLabel) as RecurringPreset[]).map((option) => (
            <Button
              key={option}
              variant="ghost"
              type="button"
              className={`min-w-0 px-3 py-2.5 transition-all border h-auto ${
                preset === option ? 'border-gray-200 bg-white shadow-sm' : 'border-transparent bg-transparent'
              }`}
              onClick={() => {
                onPresetChange(option)
                if (option === 'daily_multi_times' && multiDailyTimes.length === 0) {
                  onMultiDailyTimesChange(normalizeMultiDailyTimes([recurringTime]))
                }
                setDraftMessage(null)
              }}
            >
              <span className="text-[13px] font-semibold text-gray-900">{recurringPresetLabel[option]}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {preset === 'daily_multi_times' ? (
          <div className="col-span-2">
            <div className={sectionTitle}>Times of Day</div>
            {multiDailyTimes.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-2.5">
                {multiDailyTimes.map((time) => (
                  <span
                    key={time}
                    className="inline-flex items-center gap-2 rounded-full border border-gray-300 bg-gray-50 text-gray-900 px-2.5 py-2 text-[13px] font-medium"
                  >
                    <span>{time}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className="p-0 h-auto w-auto text-gray-500 text-sm leading-none bg-transparent border-none"
                      onClick={() => handleRemoveTime(time)}
                      title={`Remove ${time}`}
                      aria-label={`Remove ${time}`}
                    >
                      ×
                    </Button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="mb-2.5 text-xs text-gray-500">No times added yet.</div>
            )}
            <div className="flex gap-2.5 items-center">
              <Input
                type="time"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setDraftMessage(null)
                }}
              />
              <Button
                variant="outline"
                type="button"
                className="w-auto min-w-27.5 font-semibold"
                onClick={handleAddTime}
                disabled={!draft}
              >
                Add Time
              </Button>
            </div>
            <div className={`mt-1.5 text-xs ${draftMessage || validationMessage ? 'text-red-700' : 'text-gray-500'}`}>
              {draftMessage ||
                validationMessage ||
                'Add or remove time chips. A single schedule currently requires all times to share the same minute.'}
            </div>
          </div>
        ) : (
          <div>
            <div className={sectionTitle}>Time</div>
            <Input type="time" value={recurringTime} onChange={(e) => onTimeChange(e.target.value)} />
          </div>
        )}

        {(preset === 'weekly' || preset === 'every_n_weeks') && (
          <div>
            <div className={sectionTitle}>Day of Week</div>
            <Select value={String(weeklyDay)} onValueChange={(v) => onWeeklyDayChange(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {weekDayOptions.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(preset === 'monthly' || preset === 'every_n_months') && (
          <div>
            <div className={sectionTitle}>Day of Month</div>
            <Input type="number" min={1} max={28} value={monthlyDay} onChange={(e) => onMonthlyDayChange(Number(e.target.value) || 1)} />
          </div>
        )}

        {(preset === 'every_n_days' || preset === 'every_n_weeks' || preset === 'every_n_months') && (
          <div>
            <div className={sectionTitle}>Repeat Every</div>
            <Input type="number" min={1} value={everyNValue} onChange={(e) => onEveryNChange(Number(e.target.value) || 1)} />
          </div>
        )}
      </div>

      <div className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-[13px] text-gray-600">
        <div>Cron preview: <code>{cronExpression || 'Invalid recurring schedule'}</code></div>
        {cronExpression && <div className="mt-1">Summary: {describeCronExpression(cronExpression)}</div>}
      </div>
    </>
  )
}

export default RecurringScheduleEditor
