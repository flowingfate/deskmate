/**
 * 纯函数与常量：schedule overlay 的时间/cron 转换与表单类型。
 * 仅做数据计算，不含任何 React/JSX —— overlay 与其子组件共享。
 */
import {
  parseDailyMultiTimesCronExpression,
} from '../../../lib/scheduler/cronDescriptions'

export type OverlayScheduleMode = 'once' | 'recurring'
export type RecurringPreset =
  | 'daily'
  | 'daily_multi_times'
  | 'weekly'
  | 'monthly'
  | 'every_n_days'
  | 'every_n_weeks'
  | 'every_n_months'

export const MULTI_DAILY_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/
export const DEFAULT_MULTI_DAILY_TIMES = ['04:00', '08:00', '14:00', '18:00']

const pad = (value: number) => String(value).padStart(2, '0')

const buildLocalDateTimeValue = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`

export const defaultRunAt = () => {
  const next = new Date(Date.now() + 60 * 60 * 1000)
  next.setSeconds(0, 0)
  return buildLocalDateTimeValue(next)
}

/**
 * Convert a `runAtRelative` template hint to the local-datetime string
 * the overlay's `runAt` state expects. Uses local timezone so a "tomorrow
 * 09:00" template lands on the user's tomorrow morning regardless of TZ.
 */
export const buildRunAtFromRelative = (rel: { daysFromNow: number; time: string }): string => {
  const target = new Date()
  target.setDate(target.getDate() + rel.daysFromNow)
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(rel.time)
  if (match) {
    target.setHours(Number(match[1]), Number(match[2]), 0, 0)
  } else {
    target.setSeconds(0, 0)
  }
  return buildLocalDateTimeValue(target)
}

export const toIsoString = (localDateTime: string) => {
  if (!localDateTime) return ''
  const date = new Date(localDateTime)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export const buildLocalDateTimeInputFromIso = (iso?: string) => {
  if (!iso) return defaultRunAt()
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? defaultRunAt() : buildLocalDateTimeValue(date)
}

export const buildCronExpression = (
  preset: RecurringPreset,
  time: string,
  everyNValue: number,
  weeklyDay: number,
  monthlyDay: number,
) => {
  const [hourStr, minuteStr] = time.split(':')
  const minute = Number(minuteStr ?? '0')
  const hour = Number(hourStr ?? '9')
  const safeEvery = Math.max(1, everyNValue || 1)
  const safeWeeklyDay = Math.min(6, Math.max(0, weeklyDay || 1))
  const safeMonthlyDay = Math.min(28, Math.max(1, monthlyDay || 1))

  switch (preset) {
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly':
      return `${minute} ${hour} * * ${safeWeeklyDay}`
    case 'monthly':
      return `${minute} ${hour} ${safeMonthlyDay} * *`
    case 'every_n_days':
      return `${minute} ${hour} */${safeEvery} * *`
    case 'every_n_weeks':
      return `${minute} ${hour} * * ${safeWeeklyDay}/${safeEvery}`
    case 'every_n_months':
      return `${minute} ${hour} ${safeMonthlyDay} */${safeEvery} *`
    default:
      return `${minute} ${hour} * * *`
  }
}

export const recurringPresetLabel: Record<RecurringPreset, string> = {
  daily: 'Daily',
  daily_multi_times: 'Daily Multi-Time',
  weekly: 'Weekly',
  monthly: 'Monthly',
  every_n_days: 'Every N Days',
  every_n_weeks: 'Every N Weeks',
  every_n_months: 'Every N Months',
}

export type ParsedRecurringState = {
  preset: RecurringPreset
  time: string
  multiDailyTimes: string[]
  everyNValue: number
  weeklyDay: number
  monthlyDay: number
}

export const normalizeMultiDailyTimes = (times: string[]) =>
  Array.from(new Set(times.filter((time) => MULTI_DAILY_TIME_REGEX.test(time)))).sort(
    (left, right) => left.localeCompare(right),
  )

export const parseCronExpression = (cronExpression?: string): ParsedRecurringState => {
  const fallback: ParsedRecurringState = {
    preset: 'daily',
    time: '09:00',
    multiDailyTimes: DEFAULT_MULTI_DAILY_TIMES,
    everyNValue: 2,
    weeklyDay: 1,
    monthlyDay: 1,
  }

  if (!cronExpression) return fallback

  const parsedDailyMultiTimes = parseDailyMultiTimesCronExpression(cronExpression)
  if (parsedDailyMultiTimes) {
    return {
      ...fallback,
      preset: 'daily_multi_times',
      time: parsedDailyMultiTimes[0],
      multiDailyTimes: parsedDailyMultiTimes,
    }
  }

  const parts = cronExpression.trim().split(/\s+/)
  const normalizedParts = parts.length === 6 ? parts.slice(1) : parts
  if (normalizedParts.length !== 5) return fallback

  const [minuteStr, hourStr, dayOfMonth, month, dayOfWeek] = normalizedParts
  const minute = Number(minuteStr)
  const hour = Number(hourStr)

  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return fallback
  }

  const time = `${pad(hour)}:${pad(minute)}`

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { ...fallback, preset: 'daily', time }
  }

  if (dayOfMonth === '*' && month === '*' && /^\d+$/.test(dayOfWeek)) {
    return { ...fallback, preset: 'weekly', time, weeklyDay: Number(dayOfWeek) }
  }

  if (/^\*\/\d+$/.test(dayOfMonth) && month === '*' && dayOfWeek === '*') {
    return {
      ...fallback,
      preset: 'every_n_days',
      time,
      everyNValue: Number(dayOfMonth.slice(2)) || 1,
    }
  }

  if (dayOfMonth === '*' && month === '*' && /^\d+\/\d+$/.test(dayOfWeek)) {
    const [weeklyDayStr, everyNValueStr] = dayOfWeek.split('/')
    return {
      ...fallback,
      preset: 'every_n_weeks',
      time,
      weeklyDay: Number(weeklyDayStr) || 1,
      everyNValue: Number(everyNValueStr) || 1,
    }
  }

  if (/^\d+$/.test(dayOfMonth) && month === '*' && dayOfWeek === '*') {
    return {
      ...fallback,
      preset: 'monthly',
      time,
      monthlyDay: Number(dayOfMonth) || 1,
    }
  }

  if (/^\d+$/.test(dayOfMonth) && /^\*\/\d+$/.test(month) && dayOfWeek === '*') {
    return {
      ...fallback,
      preset: 'every_n_months',
      time,
      monthlyDay: Number(dayOfMonth) || 1,
      everyNValue: Number(month.slice(2)) || 1,
    }
  }

  return { ...fallback, preset: 'daily', time }
}

export const weekDayOptions = [
  { label: 'Sunday', value: 0 },
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
]
