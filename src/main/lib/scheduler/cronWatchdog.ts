import { log } from '@main/log';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { settleWithConcurrency } from './concurrency';
import { findMissedCronOccurrence, getSchedulerTimeZone } from './cronRecovery';

const logger = log.child({ mod: 'SchedulerCronWatchdog' });
const MAX_WATCHDOG_CATCH_UP_CONCURRENCY = 2;

export interface CronWatchdogTaskRuntimeMeta {
  jobId: string;
  registeredAt: string;
  cronExpression?: string;
  lastTickArrivedAt?: string;
  lastCronWatchdogCheckedAt?: string;
  lastCronWatchdogCatchUpAt?: string;
}

export interface CronWatchdogOptions {
  profileId: string | null;
  heartbeatIntervalMs: number;
  cronJobIds: string[];
  getRuntimeMeta: (jobId: string) => CronWatchdogTaskRuntimeMeta | undefined;
  setRuntimeMeta: (jobId: string, meta: CronWatchdogTaskRuntimeMeta) => void;
  /**
   * 注入：按 jobId 取最新 SchedulerJob 形状。step5 PR5 后由 SchedulerManager.getJob
   * 走 persist Profile.findJob 返回；watchdog 不再直接依赖任何存储层。
   */
  getJob: (jobId: string) => Promise<SchedulerJob | null>;
  executeJob: (job: SchedulerJob) => Promise<void>;
  nowMs?: number;
}

export async function runCronWatchdog(options: CronWatchdogOptions): Promise<void> {
  const profileId = options.profileId;
  if (!profileId) {
    return;
  }

  const checkedAtMs = options.nowMs ?? Date.now();
  const eligibleUntilMs = checkedAtMs - options.heartbeatIntervalMs;
  if (eligibleUntilMs <= 0) {
    return;
  }

  const schedulerTimeZone = getSchedulerTimeZone();
  await settleWithConcurrency(options.cronJobIds, MAX_WATCHDOG_CATCH_UP_CONCURRENCY, async (jobId) => {
    try {
      await handleCronWatchdogJob({
        ...options,
        profileId,
        jobId,
        eligibleUntilMs,
        checkedAtMs,
        schedulerTimeZone,
      });
    } catch (error) {
      logger.warn({ msg: 'Cron watchdog check failed', profileId, jobId, err: error });
    }
  });
}

async function handleCronWatchdogJob(
  options: CronWatchdogOptions & {
    profileId: string;
    jobId: string;
    eligibleUntilMs: number;
    checkedAtMs: number;
    schedulerTimeZone: string;
  },
): Promise<void> {
  const meta = options.getRuntimeMeta(options.jobId);
  if (!meta?.cronExpression) {
    return;
  }

  const lastCheckedAt = meta.lastCronWatchdogCheckedAt || meta.lastTickArrivedAt || meta.registeredAt;
  const missedOccurrence = findMissedCronOccurrence(
    meta.cronExpression,
    lastCheckedAt,
    options.eligibleUntilMs,
    options.schedulerTimeZone,
  );
  const nextCheckedAt = new Date(options.eligibleUntilMs).toISOString();

  options.setRuntimeMeta(options.jobId, {
    ...meta,
    lastCronWatchdogCheckedAt: nextCheckedAt,
  });

  if (!missedOccurrence) {
    return;
  }

  const job = await options.getJob(options.jobId);
  if (!job || !job.enabled || job.scheduleType !== 'cron' || !job.cronExpression) {
    logger.info({ msg: 'Skipped inactive cron job', profileId: options.profileId, jobId: options.jobId, missedScheduledAt: missedOccurrence.toISOString(), reason: !job ? 'job-not-found' : 'job-disabled-or-not-cron' });
    return;
  }

  const lastStartedAtMs = job.lastStartedAt ? Date.parse(job.lastStartedAt) : Number.NaN;
  if (Number.isFinite(lastStartedAtMs) && lastStartedAtMs >= missedOccurrence.getTime()) {
    logger.info({ msg: 'Skipped cron watchdog catch-up for started occurrence', profileId: options.profileId, jobId: options.jobId, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), lastStartedAt: job.lastStartedAt });
    return;
  }

  logger.warn({ msg: 'Detected missed cron occurrence', profileId: options.profileId, jobId: options.jobId, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), checkedAt: new Date(options.checkedAtMs).toISOString(), schedulerTimeZone: options.schedulerTimeZone });

  const latestMeta = options.getRuntimeMeta(options.jobId);
  if (latestMeta) {
    options.setRuntimeMeta(options.jobId, {
      ...latestMeta,
      lastCronWatchdogCatchUpAt: missedOccurrence.toISOString(),
    });
  }

  await options.executeJob(job);
}
