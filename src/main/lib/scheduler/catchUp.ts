import { log } from '@main/log';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { settleWithConcurrency } from './concurrency';
import type { SchedulerContext } from './context';
import {
  findMissedCronOccurrence,
  getColdStartCatchUpBaseline,
  getSchedulerTimeZone,
  MAX_RESUME_CATCH_UP_DELAY_MS,
  shouldCatchUpMissedOccurrence,
} from './cronRecovery';
import { executeSchedulerJob } from './execution';
import type { SchedulerTaskRuntime } from './taskRuntime';
import type { SchedulerExecutionResult } from './types';

const logger = log.child({ mod: 'SchedulerCatchUp' });
const MAX_CATCH_UP_CONCURRENCY = 2;

type CronSchedulerJob = Extract<SchedulerJob, { scheduleType: 'cron' }>;
type SchedulerStateBaseline = {
  isActive: boolean;
  lastActivatedAt?: string;
  lastDeactivatedAt?: string;
};
export type PendingCatchUps = Record<string, { occurrenceAt: string; recordedAt: string }>;

export function getOrphanedPendingCatchUpJobIds(
  jobs: readonly SchedulerJob[],
  pendingCatchUps: PendingCatchUps,
): string[] {
  const enabledCronJobIds = new Set(
    jobs.filter((job) => job.enabled && job.scheduleType === 'cron').map((job) => job.id),
  );
  return Object.keys(pendingCatchUps).filter((jobId) => !enabledCronJobIds.has(jobId));
}

/**
 * 补跑：interrupted run 恢复、cold-start 补跑、系统恢复补跑。活动状态从 context 读；
 * 补跑触发直接调 executeSchedulerJob（与正常触发同一路径），并用 taskRuntime 维护 meta。
 */
export class SchedulerCatchUp {
  constructor(
    private readonly context: SchedulerContext,
    private readonly taskRuntime: SchedulerTaskRuntime,
  ) {}

  async recoverInterruptedScheduledSessions(): Promise<void> {
    const profile = this.context.profile;
    if (!profile) {
      logger.info({ msg: 'Skipped interrupted-run recovery', profileId: this.context.profileId, schedulerGeneration: this.context.generation, reason: 'no-active-profile' });
      return;
    }

    let totalRecovered = 0;
    try {
      const flat = await profile.listJobsFlat();
      const completedAt = new Date().toISOString();
      const error = 'Interrupted by app shutdown';
      for (const { job } of flat) {
        const runs = await job.listRunsOnDisk();
        for (const run of runs) {
          if (run.runStatus !== 'running') {
            continue;
          }
          try {
            await job.finishRun(run.id, { status: 'failed', completedAt, error });
            totalRecovered += 1;
          } catch (caughtError) {
            logger.warn({ msg: 'Failed to finish interrupted run', profileId: this.context.profileId, jobId: job.id, runId: run.id, err: caughtError });
          }
        }
      }
    } catch (error) {
      logger.warn({ msg: 'Failed to recover interrupted runs', profileId: this.context.profileId, err: error });
    }

    logger.info({ msg: 'Recovered interrupted runs', profileId: this.context.profileId, schedulerGeneration: this.context.generation, recovered: totalRecovered });
  }

  async handleSystemResume(suspendedAtMs: number, resumedAtMs: number): Promise<void> {
    if (
      !this.context.profileId
      || !Number.isFinite(suspendedAtMs)
      || !Number.isFinite(resumedAtMs)
      || resumedAtMs <= suspendedAtMs
    ) {
      return;
    }

    const schedulerGeneration = this.context.generation;
    try {
      const recurringJobs = (await this.context.listJobs()).filter(
        (job): job is CronSchedulerJob => job.enabled && job.scheduleType === 'cron',
      );
      if (recurringJobs.length === 0) {
        return;
      }

      const schedulerTimeZone = getSchedulerTimeZone();
      const candidates = recurringJobs.flatMap((job) => {
        const missedOccurrence = findMissedCronOccurrence(
          job.cronExpression,
          suspendedAtMs,
          resumedAtMs,
          schedulerTimeZone,
        );
        if (!missedOccurrence) {
          return [];
        }

        const catchUpDelayMs = resumedAtMs - missedOccurrence.getTime();
        if (!shouldCatchUpMissedOccurrence(missedOccurrence, resumedAtMs)) {
          logger.info({ msg: 'Skipped stale resume catch-up', profileId: this.context.profileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), catchUpDelayMs, maxCatchUpDelayMs: MAX_RESUME_CATCH_UP_DELAY_MS });
          return [];
        }

        const lastStartedAtMs = job.lastStartedAt ? Date.parse(job.lastStartedAt) : Number.NaN;
        if (Number.isFinite(lastStartedAtMs) && lastStartedAtMs >= missedOccurrence.getTime()) {
          logger.info({ msg: 'Skipped resume catch-up for started occurrence', profileId: this.context.profileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), lastStartedAt: job.lastStartedAt });
          return [];
        }

        logger.info({ msg: 'Selected resume catch-up occurrence', profileId: this.context.profileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), catchUpDelayMs });
        return [job];
      });

      logger.info({ msg: 'Started resume catch-up', profileId: this.context.profileId, schedulerGeneration, recurringJobs: recurringJobs.length, candidates: candidates.length, suspendedAt: new Date(suspendedAtMs).toISOString(), resumedAt: new Date(resumedAtMs).toISOString(), schedulerTimeZone });
      const settled = await settleWithConcurrency(
        candidates,
        MAX_CATCH_UP_CONCURRENCY,
        (job) => executeSchedulerJob({
          job,
          triggerSource: 'resume-catchup',
          context: this.context,
          taskRuntime: this.taskRuntime,
          expectedGeneration: schedulerGeneration,
        }),
      );
      const recoveredRuns = settled.filter(
        (result) => result.status === 'fulfilled' && result.value.success,
      ).length;
      logger.info({ msg: 'Finished resume catch-up', profileId: this.context.profileId, schedulerGeneration, recurringJobs: recurringJobs.length, recoveredRuns });
    } catch (error) {
      logger.warn({ msg: 'Failed resume catch-up', profileId: this.context.profileId, err: error });
    }
  }

  async handleColdStartCatchUp(
    startupAtMs: number,
    jobs: SchedulerJob[],
    baseline: SchedulerStateBaseline | null,
    pendingCatchUps: PendingCatchUps,
    schedulerGeneration: number,
  ): Promise<void> {
    const profile = this.context.profile;
    if (!profile || !this.context.isCurrentGeneration(schedulerGeneration)) {
      return;
    }

    const recurringJobs = jobs.filter(
      (job): job is CronSchedulerJob => job.enabled && job.scheduleType === 'cron',
    );
    for (const jobId of getOrphanedPendingCatchUpJobIds(jobs, pendingCatchUps)) {
      await profile.schedulerState.dequeueCatchUp(jobId);
      logger.info({ msg: 'Dropped orphaned pending catch-up', profileId: this.context.profileId, jobId, pendingOccurrenceAt: pendingCatchUps[jobId].occurrenceAt });
    }

    if (recurringJobs.length === 0) {
      return;
    }

    const pendingCandidates: Array<{ job: CronSchedulerJob; occurrenceAt: string }> = [];
    for (const job of recurringJobs) {
      const pendingCatchUp = pendingCatchUps[job.id];
      if (!pendingCatchUp) {
        continue;
      }

      const pendingOccurrence = new Date(pendingCatchUp.occurrenceAt);
      if (!shouldCatchUpMissedOccurrence(pendingOccurrence, startupAtMs)) {
        await profile.schedulerState.dequeueCatchUp(job.id);
        logger.info({ msg: 'Dropped stale pending catch-up', profileId: this.context.profileId, jobId: job.id, name: job.name, pendingOccurrenceAt: pendingCatchUp.occurrenceAt, recordedAt: pendingCatchUp.recordedAt });
        continue;
      }

      pendingCandidates.push({ job, occurrenceAt: pendingCatchUp.occurrenceAt });
      logger.info({ msg: 'Replaying pending catch-up', profileId: this.context.profileId, jobId: job.id, name: job.name, pendingOccurrenceAt: pendingCatchUp.occurrenceAt });
    }

    const pendingSettled = await settleWithConcurrency(
      pendingCandidates,
      MAX_CATCH_UP_CONCURRENCY,
      ({ job, occurrenceAt }) => this.executeColdStartCatchUp(job, occurrenceAt, true, schedulerGeneration),
    );
    const replayedPendingOccurrences = new Set(
      pendingSettled.flatMap((result, index) => (
        result.status === 'fulfilled' && result.value.success
          ? [`${pendingCandidates[index].job.id}::${pendingCandidates[index].occurrenceAt}`]
          : []
      )),
    );
    let recoveredRuns = replayedPendingOccurrences.size;

    const computedBaseline = getColdStartCatchUpBaseline(baseline);
    if (!computedBaseline) {
      logger.info({ msg: 'Finished cold-start catch-up without baseline', profileId: this.context.profileId, recurringJobs: recurringJobs.length, recoveredRuns });
      return;
    }

    const schedulerTimeZone = getSchedulerTimeZone();
    const baselineCandidates = recurringJobs.flatMap((job) => {
      const missedOccurrence = findMissedCronOccurrence(
        job.cronExpression,
        computedBaseline.windowStartAt,
        startupAtMs,
        schedulerTimeZone,
      );
      if (!missedOccurrence) {
        return [];
      }

      const occurrenceAt = missedOccurrence.toISOString();
      if (replayedPendingOccurrences.has(`${job.id}::${occurrenceAt}`)) {
        return [];
      }

      const lastStartedAtMs = job.lastStartedAt ? Date.parse(job.lastStartedAt) : Number.NaN;
      if (Number.isFinite(lastStartedAtMs) && lastStartedAtMs >= missedOccurrence.getTime()) {
        logger.info({ msg: 'Skipped cold-start catch-up for started occurrence', profileId: this.context.profileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: occurrenceAt, lastStartedAt: job.lastStartedAt });
        return [];
      }

      const catchUpDelayMs = startupAtMs - missedOccurrence.getTime();
      if (!shouldCatchUpMissedOccurrence(missedOccurrence, startupAtMs)) {
        logger.info({ msg: 'Skipped stale cold-start catch-up', profileId: this.context.profileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: occurrenceAt, catchUpDelayMs, maxCatchUpDelayMs: MAX_RESUME_CATCH_UP_DELAY_MS });
        return [];
      }

      logger.info({ msg: 'Selected cold-start catch-up occurrence', profileId: this.context.profileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: occurrenceAt, catchUpDelayMs, baselineSource: computedBaseline.source });
      return [{ job, occurrenceAt }];
    });

    logger.info({ msg: 'Started cold-start catch-up', profileId: this.context.profileId, schedulerGeneration, recurringJobs: recurringJobs.length, candidates: baselineCandidates.length, windowStartAt: computedBaseline.windowStartAt, startupAt: new Date(startupAtMs).toISOString(), baselineSource: computedBaseline.source, schedulerTimeZone });
    const baselineSettled = await settleWithConcurrency(
      baselineCandidates,
      MAX_CATCH_UP_CONCURRENCY,
      ({ job, occurrenceAt }) => this.executeColdStartCatchUp(job, occurrenceAt, false, schedulerGeneration),
    );
    recoveredRuns += baselineSettled.filter(
      (result) => result.status === 'fulfilled' && result.value.success,
    ).length;
    logger.info({ msg: 'Finished cold-start catch-up', profileId: this.context.profileId, schedulerGeneration, recurringJobs: recurringJobs.length, recoveredRuns, baselineSource: computedBaseline.source });
  }

  private async executeColdStartCatchUp(
    job: CronSchedulerJob,
    occurrenceAt: string,
    alreadyPending: boolean,
    schedulerGeneration: number,
  ): Promise<SchedulerExecutionResult> {
    const profile = this.context.profile;
    if (!profile || !this.context.isCurrentGeneration(schedulerGeneration)) {
      return { success: false, error: 'Scheduler generation is no longer active.' };
    }

    if (!alreadyPending) {
      await profile.schedulerState.enqueueCatchUp(job.id, occurrenceAt, new Date().toISOString());
    }
    if (!this.context.isCurrentGeneration(schedulerGeneration)) {
      return { success: false, error: 'Scheduler generation is no longer active.' };
    }

    const latestJob = await this.context.getJob(job.id);
    if (!latestJob || !latestJob.enabled || latestJob.scheduleType !== 'cron') {
      return { success: false, error: 'Schedule is no longer an enabled cron job.' };
    }

    const result = await executeSchedulerJob({
      job: latestJob,
      triggerSource: 'cold-start-catchup',
      context: this.context,
      taskRuntime: this.taskRuntime,
      expectedGeneration: schedulerGeneration,
    });
    if (result.success && this.context.isCurrentGeneration(schedulerGeneration)) {
      await profile.schedulerState.dequeueCatchUp(job.id);
    }
    return result;
  }
}
