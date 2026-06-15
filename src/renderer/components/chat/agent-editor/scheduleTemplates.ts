/**
 * Schedule Templates
 *
 * Predefined schedules that appear in `JobHeader`'s "+" dropdown.
 * Each template hands the overlay a pre-filled `AddScheduleOverlayInitialValues`
 * built from the current agent's name. The overlay remains the single source of
 * truth for the schedule form; templates only seed it.
 */

import type { AddScheduleOverlayInitialValues } from './AddScheduleOverlay'

/** Re-export so callers can refer to the template payload without reaching into the overlay module. */
export type { AddScheduleOverlayInitialValues as ScheduleTemplateInitialValues }

/** Context passed into `buildInitialValues`. Intentionally narrow — agent name is all the seeds need today. */
export interface ScheduleTemplateContext {
  agentName?: string
}

export interface ScheduleTemplate {
  id: string
  /** Item label rendered in the "+" dropdown. */
  label: string
  /** Tooltip shown on hover; one short sentence describing when the schedule fires. */
  tooltip: string
  /** Build the overlay's `initialValues` from the (lightweight) agent context. */
  buildInitialValues: (ctx: ScheduleTemplateContext) => AddScheduleOverlayInitialValues
}

// Day-of-week codes for `recurringPreset === 'weekly'`. The overlay uses 0 = Sunday.
const MONDAY = 1
const FRIDAY = 5

/** Suffix all template-generated job names with the agent name so users can tell them apart in the cross-agent list. */
const withAgent = (base: string, agentName?: string): string =>
  agentName ? `${base} – ${agentName}` : base

const BRIEFING_TEMPLATE: ScheduleTemplate = {
  id: 'briefing',
  label: 'Daily Briefing',
  tooltip: 'Every morning at 09:00 — a quick summary to start the day',
  buildInitialValues: ({ agentName }) => ({
    name: withAgent('Daily Briefing', agentName),
    description: `Daily briefing for ${agentName ?? 'this agent'}`,
    message:
      'Give me a short morning briefing: top 3 things on my plate today, anything that slipped from yesterday, and one thing I should not forget.',
    mode: 'recurring',
    recurringPreset: 'daily',
    recurringTime: '09:00',
  }),
}

const WEEKLY_STANDUP_TEMPLATE: ScheduleTemplate = {
  id: 'weekly_standup',
  label: 'Weekly Standup',
  tooltip: 'Monday 09:00 — recap last week and set this week\'s priorities',
  buildInitialValues: ({ agentName }) => ({
    name: withAgent('Weekly Standup', agentName),
    description: 'Monday morning standup',
    message:
      'Run a weekly standup. Summarize what got done last week (concrete outcomes, not activity), then list the top 3 priorities for this week with a one-line rationale each.',
    mode: 'recurring',
    recurringPreset: 'weekly',
    recurringTime: '09:00',
    weeklyDay: MONDAY,
  }),
}

const MONTHLY_REPORT_TEMPLATE: ScheduleTemplate = {
  id: 'monthly_report',
  label: 'Monthly Report',
  tooltip: '1st of each month at 09:00 — monthly review and unresolved threads',
  buildInitialValues: ({ agentName }) => ({
    name: withAgent('Monthly Report', agentName),
    description: 'First-of-month activity review',
    message:
      'Produce a monthly report: what was accomplished this past month, recurring themes worth noticing, and unresolved threads that should carry into next month. Keep it tight — section headings, no filler.',
    mode: 'recurring',
    recurringPreset: 'monthly',
    recurringTime: '09:00',
    monthlyDay: 1,
  }),
}

const FRIDAY_RETRO_TEMPLATE: ScheduleTemplate = {
  id: 'friday_retro',
  label: 'Friday Retro',
  tooltip: 'Friday 16:00 — wrap up the week with a short retrospective',
  buildInitialValues: ({ agentName }) => ({
    name: withAgent('Friday Retro', agentName),
    description: 'End-of-week retrospective',
    message:
      'Wrap up the week: what went well, what stalled, and the single biggest improvement I should try next week. Be specific — no platitudes.',
    mode: 'recurring',
    recurringPreset: 'weekly',
    recurringTime: '16:00',
    weeklyDay: FRIDAY,
  }),
}

const INBOX_TRIAGE_TEMPLATE: ScheduleTemplate = {
  id: 'inbox_triage',
  label: 'Inbox Triage',
  tooltip: 'Twice daily (08:30 & 16:00) — surface what needs a reply',
  buildInitialValues: ({ agentName }) => ({
    name: withAgent('Inbox Triage', agentName),
    description: 'Twice-daily inbox & open-thread sweep',
    message:
      'Sweep my inbox and any open threads since the last triage. Surface anything urgent first, then summarize the rest in one or two lines each, and call out items that need a reply from me with a suggested next step.',
    mode: 'recurring',
    recurringPreset: 'daily_multi_times',
    multiDailyTimes: ['08:30', '16:00'],
  }),
}

/** All built-in schedule templates. Add new entries here. */
export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  BRIEFING_TEMPLATE,
  WEEKLY_STANDUP_TEMPLATE,
  FRIDAY_RETRO_TEMPLATE,
  INBOX_TRIAGE_TEMPLATE,
  MONTHLY_REPORT_TEMPLATE,
]
