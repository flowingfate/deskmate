import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shadcn/dialog'
import { Switch } from '@/shadcn/switch'
import { Button } from '@/shadcn/button'
import { Input } from '@/shadcn/input'
import { Textarea } from '@/shadcn/textarea'
import { schedulerApi } from '../../../ipc/scheduler'
import type { SchedulerJob } from '@shared/ipc/scheduler'
import { buildDailyMultiTimesCronExpression } from '../../../lib/scheduler/cronDescriptions'
import {
  buildCronExpression,
  buildLocalDateTimeInputFromIso,
  buildRunAtFromRelative,
  defaultRunAt,
  DEFAULT_MULTI_DAILY_TIMES,
  normalizeMultiDailyTimes,
  parseCronExpression,
  toIsoString,
  type OverlayScheduleMode,
  type RecurringPreset,
} from './scheduleForm'
import ScheduleTypeCards from './ScheduleTypeCards'
import RecurringScheduleEditor from './RecurringScheduleEditor'

export interface AddScheduleOverlayInitialValues {
  /** Job display name. */
  name?: string
  /** Job description. */
  description?: string
  /** Initial prompt sent when the job fires. */
  message?: string
  /** `'once'` (one-time) vs `'recurring'` (cron). */
  mode?: OverlayScheduleMode
  // ── recurring fields ──
  recurringPreset?: RecurringPreset
  /** `HH:mm` local. Used by daily / weekly / monthly / every_n_*. */
  recurringTime?: string
  /** `['HH:mm', ...]`; only honoured when `recurringPreset === 'daily_multi_times'`. */
  multiDailyTimes?: string[]
  /** 0 = Sunday … 6 = Saturday. Only honoured when `recurringPreset === 'weekly'`. */
  weeklyDay?: number
  /** 1 … 31. Only honoured when `recurringPreset === 'monthly'`. */
  monthlyDay?: number
  /** N for `every_n_days` / `every_n_weeks` / `every_n_months`. */
  everyNValue?: number
  // ── one-time fields ──
  /**
   * Relative target for one-time schedules — resolved to a concrete `runAt`
   * the moment the overlay opens. Use this instead of an absolute ISO so
   * a template that says "tomorrow at 09:00" stays meaningful regardless of
   * when the user clicks it.
   */
  runAtRelative?: {
    /** 0 = today, 1 = tomorrow, … */
    daysFromNow: number
    /** `HH:mm` local. */
    time: string
  }
}

interface AddScheduleOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultAgentId?: string
  editingJob?: SchedulerJob | null
  onCreated?: (job: SchedulerJob) => void
  onUpdated?: (job: SchedulerJob) => void
  /** Pre-fill values when creating a new schedule (not editing). */
  initialValues?: AddScheduleOverlayInitialValues
}

const sectionTitle = 'text-sm font-bold text-gray-900 mb-2'

const ScheduleOverlay: React.FC<AddScheduleOverlayProps> = ({
  open,
  onOpenChange,
  defaultAgentId,
  editingJob,
  onCreated,
  onUpdated,
  initialValues,
}) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [agentId, setAgentId] = useState(defaultAgentId || '')
  const [mode, setMode] = useState<OverlayScheduleMode>('once')

  const [runAt, setRunAt] = useState(defaultRunAt())
  const [recurringPreset, setRecurringPreset] = useState<RecurringPreset>('daily')
  const [recurringTime, setRecurringTime] = useState('09:00')
  const [multiDailyTimes, setMultiDailyTimes] = useState<string[]>(DEFAULT_MULTI_DAILY_TIMES)
  const [everyNValue, setEveryNValue] = useState(2)
  const [weeklyDay, setWeeklyDay] = useState(1)
  const [monthlyDay, setMonthlyDay] = useState(1)
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return

    if (editingJob) {
      const parsedCron = parseCronExpression(editingJob.cronExpression)

      setName(editingJob.name || '')
      setDescription(editingJob.description || '')
      setMessage(editingJob.message || '')
      setAgentId(editingJob.agentId || defaultAgentId || '')
      setMode(editingJob.scheduleType === 'cron' ? 'recurring' : 'once')
      setRunAt(buildLocalDateTimeInputFromIso(editingJob.runAt))
      setRecurringPreset(parsedCron.preset)
      setRecurringTime(parsedCron.time)
      setMultiDailyTimes(normalizeMultiDailyTimes(parsedCron.multiDailyTimes))
      setEveryNValue(parsedCron.everyNValue)
      setWeeklyDay(parsedCron.weeklyDay)
      setMonthlyDay(parsedCron.monthlyDay)
      setNotifyOnCompletion(editingJob.notifyOnCompletion !== false)
    } else {
      setName(initialValues?.name || '')
      setDescription(initialValues?.description || '')
      setMessage(initialValues?.message || '')
      setAgentId(defaultAgentId || '')
      setMode(initialValues?.mode || 'once')
      setRunAt(initialValues?.runAtRelative
        ? buildRunAtFromRelative(initialValues.runAtRelative)
        : defaultRunAt())
      setRecurringPreset((initialValues?.recurringPreset as RecurringPreset) || 'daily')
      setRecurringTime(initialValues?.recurringTime || '09:00')
      setMultiDailyTimes(
        initialValues?.multiDailyTimes && initialValues.multiDailyTimes.length > 0
          ? normalizeMultiDailyTimes(initialValues.multiDailyTimes)
          : DEFAULT_MULTI_DAILY_TIMES,
      )
      setEveryNValue(initialValues?.everyNValue ?? 2)
      setWeeklyDay(initialValues?.weeklyDay ?? 1)
      setMonthlyDay(initialValues?.monthlyDay ?? 1)
      setNotifyOnCompletion(true)
    }

    setSubmitting(false)
    setError(null)
  }, [open, editingJob, defaultAgentId, initialValues])

  const dailyMultiTimesResult = useMemo(() => {
    if (mode !== 'recurring' || recurringPreset !== 'daily_multi_times') {
      return null
    }
    return buildDailyMultiTimesCronExpression(multiDailyTimes.join(', '))
  }, [mode, recurringPreset, multiDailyTimes])

  const cronExpression = useMemo(() => {
    if (mode !== 'recurring') return undefined
    if (recurringPreset === 'daily_multi_times') {
      return dailyMultiTimesResult?.cronExpression
    }
    return buildCronExpression(recurringPreset, recurringTime, everyNValue, weeklyDay, monthlyDay)
  }, [mode, recurringPreset, recurringTime, everyNValue, weeklyDay, monthlyDay, dailyMultiTimesResult])

  const recurringValidationMessage = useMemo(() => {
    if (mode !== 'recurring' || recurringPreset !== 'daily_multi_times') {
      return null
    }
    return dailyMultiTimesResult?.error || null
  }, [mode, recurringPreset, dailyMultiTimesResult])

  const canSubmit = useMemo(() => {
    if (!name.trim() || !description.trim() || !message.trim() || !agentId) {
      return false
    }
    if (mode === 'once') {
      return !!toIsoString(runAt)
    }
    return !!cronExpression && !recurringValidationMessage
  }, [name, description, message, agentId, mode, runAt, cronExpression, recurringValidationMessage])

  const isEditMode = !!editingJob
  const dialogTitle = isEditMode ? 'Edit Schedule' : 'Add New Schedule'
  const dialogDescription = isEditMode
    ? 'Update this one-time or recurring schedule configuration.'
    : 'Create a one-time or recurring schedule for an agent. The current agent is selected by default.'
  const submitButtonTitle = isEditMode ? 'Update schedule' : 'Create schedule'
  const submitButtonLabel = submitting
    ? (isEditMode ? 'Updating...' : 'Creating...')
    : (isEditMode ? 'Update Schedule' : 'Add New Schedule')

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return

    try {
      setSubmitting(true)
      setError(null)

      const trimmedName = name.trim()
      const trimmedDescription = description.trim()
      const trimmedMessage = message.trim()
      const scheduleType: SchedulerJob['scheduleType'] = mode === 'once' ? 'once' : 'cron'
      const nextCronExpression = mode === 'recurring' ? cronExpression : undefined
      const nextRunAt = mode === 'once' ? toIsoString(runAt) : undefined

      if (editingJob) {
        const updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'agentId' | 'notifyOnCompletion'>> = {
          name: trimmedName,
          description: trimmedDescription,
          message: trimmedMessage,
          scheduleType,
          cronExpression: nextCronExpression,
          runAt: nextRunAt,
          agentId,
          notifyOnCompletion,
        }

        const response = await schedulerApi.updateJob(editingJob.id, updates)
        if (response?.success) {
          const updatedJob: SchedulerJob = {
            ...editingJob,
            ...updates,
          }
          onUpdated?.(updatedJob)
          onOpenChange(false)
          return
        }

        setError(response?.error || 'Failed to update schedule')
        return
      }

      const job = {
        description: trimmedDescription,
        name: trimmedName,
        scheduleType,
        cronExpression: nextCronExpression,
        runAt: nextRunAt,
        enabled: true,
        agentId,
        message: trimmedMessage,
        status: 'pending' as const,
        notifyOnCompletion,
      }

      const response = await schedulerApi.createJob(job)
      if (response?.success) {
        onCreated?.({
          ...job,
          id: response.data?.jobId ?? '',
          lastRunAt: undefined,
          executedAt: undefined,
        } as SchedulerJob)
        onOpenChange(false)
        return
      }

      setError(response?.error || 'Failed to create schedule')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [agentId, canSubmit, cronExpression, description, editingJob, message, mode, name, notifyOnCompletion, onCreated, onOpenChange, onUpdated, runAt, submitting])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocusRef={nameInputRef} className="w-190 max-w-190 max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-2">
          <div className="flex flex-col gap-4.5 mt-4">
            {error && (
              <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13px]">
                {error}
              </div>
            )}

            <ScheduleTypeCards mode={mode} onChange={setMode} />

            <div>
              <div className={sectionTitle}>Schedule Name</div>
              <Input ref={nameInputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily standup summary" />
            </div>

            <div>
              <div className={sectionTitle}>Description</div>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Summarize the latest project status every morning" />
            </div>

            <div>
              <div className={sectionTitle}>Prompt Message</div>
              <Textarea className="min-h-24 resize-y" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write the exact prompt that the agent should receive when this schedule runs." />
            </div>

            <div className="flex items-center justify-between px-3.5 py-3 rounded-[10px] border border-gray-200 bg-white">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-gray-900">Notify on completion</span>
                <span className="text-xs text-gray-500">Send a notification when this task finishes</span>
              </div>
              <Switch size="sm" checked={notifyOnCompletion} onCheckedChange={setNotifyOnCompletion} />
            </div>

            {mode === 'once' ? (
              <div>
                <div className={sectionTitle}>Run At</div>
                <Input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
              </div>
            ) : (
              <RecurringScheduleEditor
                preset={recurringPreset}
                recurringTime={recurringTime}
                multiDailyTimes={multiDailyTimes}
                everyNValue={everyNValue}
                weeklyDay={weeklyDay}
                monthlyDay={monthlyDay}
                cronExpression={cronExpression}
                validationMessage={recurringValidationMessage}
                onPresetChange={setRecurringPreset}
                onTimeChange={setRecurringTime}
                onMultiDailyTimesChange={setMultiDailyTimes}
                onEveryNChange={setEveryNValue}
                onWeeklyDayChange={setWeeklyDay}
                onMonthlyDayChange={setMonthlyDay}
              />
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-gray-200 px-6 py-4 flex flex-row justify-end gap-2 sm:flex-row sm:space-x-0">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={handleSubmit} disabled={!canSubmit || submitting} title={submitButtonTitle}>
            {submitButtonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ScheduleOverlay
