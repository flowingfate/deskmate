import type { JobRunRow } from '@shared/persist/types';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { isInterruptedScheduledSessionError } from '@shared/constants/scheduler';
import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions';

export type ScheduledSessionDisplayState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted';

/** Map a `JobRunRow` to its UI state bucket. */
export function getScheduledSessionDisplayState(
  run: JobRunRow,
): ScheduledSessionDisplayState {
  if (run.runStatus === 'running') return 'running';
  if (run.runStatus === 'failed') {
    return isInterruptedScheduledSessionError(run.runError ?? '') ? 'interrupted' : 'failed';
  }
  return 'completed';
}

/** Long-form date+time, used in JobRow subtitle for one-time schedules. */
export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Compact time-of-day, used in RunRow subtitle. */
export function formatRunTime(iso?: string): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Single-line summary describing **when** a job runs.
 * One-time → `One-time at <date>`; recurring → human cron description.
 */
export function describeSchedule(job: SchedulerJob): string {
  if (job.scheduleType === 'once') {
    return job.runAt ? `One-time at ${formatDateTime(job.runAt)}` : 'One-time schedule';
  }
  return describeCronExpression(job.cronExpression);
}

/**
 * Pick the visual status bucket for a job row's leading dot.
 * - `expired`: one-time job whose `runAt` is in the past — regardless of
 *   `enabled` and regardless of the adapter's projected `job.status`.
 *   The adapter labels any `enabled=false && once && pending` job as
 *   `'expired'` for legacy compat, but that conflates "user paused a
 *   future-dated once-job" with "the once-job's time has come and gone".
 *   Renderer derives the bucket from `runAt` directly so paused future
 *   one-time jobs stay toggleable.
 * - `enabled` / `disabled`: derived from `job.enabled`.
 */
export type JobRowStatus = 'enabled' | 'disabled' | 'expired';

export function deriveJobRowStatus(job: SchedulerJob): JobRowStatus {
  if (job.scheduleType === 'once' && job.runAt) {
    const runAtMs = Date.parse(job.runAt);
    if (!Number.isNaN(runAtMs) && runAtMs < Date.now()) return 'expired';
  }
  return job.enabled ? 'enabled' : 'disabled';
}

