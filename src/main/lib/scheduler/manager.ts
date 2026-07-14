/**
 * SchedulerManager coordinates scheduler persistence, runtime registration, and execution.
 * Schedule settings remain owned by the profile persistence layer.
 *
 * 活动状态（当前 profile / generation）集中在 SchedulerContext；taskRuntime / catchUp
 * 按引用共享同一份 context，manager 只在生命周期切换时写入它。
 */

import { log } from '@main/log';
import type { Profile } from '@main/persist';
import type { SchedulerJob, SchedulerJobCreateInput, SchedulerJobUpdate } from '@shared/ipc/scheduler';
import { SchedulerCatchUp } from './catchUp';
import { SchedulerContext } from './context';
import { executeSchedulerJob } from './execution';
import { SchedulerTaskRuntime } from './taskRuntime';
import { toPersistScheduleJobUpdate, toSchedulerJob, toScheduleJobInput } from './jobAdapter';
import type {
  SchedulerDisposeReason,
  SchedulerExecutionResult,
  SchedulerRuntimeDiagnostics,
} from './types';

const logger = log.child({ mod: 'SchedulerManager' });

type SchedulerInitialization = {
  startupAtMs: number;
  startupAtIso: string;
  schedulerGeneration: number;
  previousGeneration: number;
  previousProfileId: string | null;
  previousActiveTasks: number;
  activeJobIdsBefore: string[];
};

type SchedulerInitializationClearReason = 'initialize-clear' | 'profile-switch';

export class SchedulerManager {
  private readonly context = new SchedulerContext();
  private readonly taskRuntime = new SchedulerTaskRuntime(this.context);
  private readonly catchUp = new SchedulerCatchUp(this.context, this.taskRuntime);

  getRuntimeDiagnostics(): SchedulerRuntimeDiagnostics {
    return this.taskRuntime.getRuntimeDiagnostics();
  }

  /**
   * 初始化当前 profile 的运行时任务。调用方必须传入已加载的 active Profile。
   */
  async initialize(profile: Profile): Promise<void> {
    await this.completeInitialization(
      this.prepareInitialization(profile, 'initialize-clear'),
    );
  }

  /**
   * 切换至新 profile：立即撤销旧任务，再落旧 profile 的停用基线并注册新任务。
   */
  async switch(profile: Profile): Promise<void> {
    const previous =  this.context.profile;
    const initialization = this.prepareInitialization(profile, 'profile-switch', previous?.id ?? null);
    if (previous && previous.id !== profile.id) {
      try {
        await previous.schedulerState.markDeactivated(initialization.startupAtIso);
      } catch (error) {
        logger.warn({ msg: 'Failed to mark previous profile inactive', previousProfileId: previous.id, err: error });
      }
    }
    await this.completeInitialization(initialization);
  }

  private prepareInitialization(
    profile: Profile,
    clearReason: SchedulerInitializationClearReason,
    previousProfileId = this.context.profileId,
  ): SchedulerInitialization {
    const previousGeneration = this.context.generation;
    this.context.generation += 1;
    const schedulerGeneration = this.context.generation;
    const previousActiveTasks = this.taskRuntime.getActiveTaskCount();
    const activeJobIdsBefore = this.taskRuntime.getActiveJobIds();
    const startupAtMs = Date.now();
    const startupAtIso = new Date(startupAtMs).toISOString();

    this.taskRuntime.clearActiveTasks(clearReason);
    this.context.profile = profile;

    return { startupAtMs, startupAtIso, schedulerGeneration, previousGeneration, previousProfileId, previousActiveTasks, activeJobIdsBefore };
  }

  private async completeInitialization({
    startupAtMs,
    startupAtIso,
    schedulerGeneration,
    previousGeneration,
    previousProfileId,
    previousActiveTasks,
    activeJobIdsBefore,
  }: SchedulerInitialization): Promise<void> {
    logger.info({ msg: 'Started initialization', profileId: this.context.profileId, previousProfileId, schedulerGeneration, previousGeneration, activeTaskCountBefore: previousActiveTasks, activeJobIdsBefore, pid: process.pid, uptimeMs: Math.round(process.uptime() * 1000) });

    try {
      await this.catchUp.recoverInterruptedScheduledSessions();
      logger.info({ msg: 'Completed interrupted-run recovery', profileId: this.context.profileId, schedulerGeneration });

      let baselineSnapshot: {
        isActive: boolean;
        lastActivatedAt?: string;
        lastDeactivatedAt?: string;
      } | null = null;
      let pendingSnapshot: Record<string, { occurrenceAt: string; recordedAt: string }> = {};
      const profile = this.context.profile;
      if (profile) {
        try {
          await profile.schedulerState.load();
          baselineSnapshot = profile.schedulerState.getBaseline();
          pendingSnapshot = profile.schedulerState.getPending();
          await profile.schedulerState.markActivated(startupAtIso);
        } catch (error) {
          logger.warn({ msg: 'Failed to load scheduler state', profileId: this.context.profileId, err: error });
        }
      }

      const jobs = await this.context.listJobs();
      const enabledJobs = jobs.filter((job) => job.enabled);
      const cronJobs = enabledJobs.filter((job) => job.scheduleType === 'cron').length;
      const oneTimeJobs = enabledJobs.filter((job) => job.scheduleType === 'once').length;
      logger.info({ msg: 'Loaded jobs', profileId: this.context.profileId, schedulerGeneration, totalJobs: jobs.length, enabledJobs: enabledJobs.length, disabledJobs: jobs.length - enabledJobs.length, enabledCronJobs: cronJobs, enabledOneTimeJobs: oneTimeJobs, enabledJobIds: enabledJobs.map((job) => job.id), enabledJobSnapshots: enabledJobs.map((job) => ({
        jobId: job.id,
        name: job.name,
        scheduleType: job.scheduleType,
        cronExpression: job.scheduleType === 'cron' ? job.cronExpression : undefined,
        runAt: job.scheduleType === 'once' ? job.runAt : undefined,
        enabled: job.enabled,
        lastStartedAt: job.lastStartedAt,
      })) });

      let registrationFailures = 0;
      for (const job of enabledJobs) {
        try {
          await this.taskRuntime.registerJob(job);
        } catch (error) {
          registrationFailures += 1;
          logger.warn({ msg: 'Failed to register job', profileId: this.context.profileId, schedulerGeneration, jobId: job.id, name: job.name, scheduleType: job.scheduleType, err: error });
        }
      }

      logger.info({ msg: 'Finished initialization', profileId: this.context.profileId, schedulerGeneration, totalJobs: jobs.length, enabledJobs: enabledJobs.length, registrationFailures, activeTasks: this.taskRuntime.getActiveTaskCount(), activeJobIds: this.taskRuntime.getActiveJobIds() });
      this.taskRuntime.startHeartbeat();
      void this.catchUp.handleColdStartCatchUp(
        startupAtMs,
        jobs,
        baselineSnapshot,
        pendingSnapshot,
        schedulerGeneration,
      ).catch((error) => {
        logger.warn({ msg: 'Cold-start catch-up failed', profileId: this.context.profileId, schedulerGeneration, err: error });
      });
    } catch (error) {
      logger.warn({ msg: 'Initialization failed', profileId: this.context.profileId, schedulerGeneration, err: error, activeTasks: this.taskRuntime.getActiveTaskCount(), activeJobIds: this.taskRuntime.getActiveJobIds() });
    }
  }

  async createJob(job: SchedulerJobCreateInput): Promise<string> {
    const profile = this.context.requireProfile();

    try {
      const agent = await profile.getAgent(job.agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${job.agentId}`);
      }
      const created = await agent.createJob(toScheduleJobInput(job));
      const schedulerJob = toSchedulerJob(created.toFile(), created.config.runState);
      if (schedulerJob.enabled) {
        await this.taskRuntime.registerJob(schedulerJob);
      }
      return created.id;
    } catch (error) {
      logger.warn({ msg: 'Failed to create job', profileId: this.context.profileId, agentId: job.agentId, err: error });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async deleteJob(jobId: string): Promise<boolean> {
    const profile = this.context.requireProfile();

    this.taskRuntime.unregisterTask(jobId, 'delete-job');
    const hit = await profile.findJob(jobId);
    if (!hit) {
      throw new Error(`Schedule job not found: ${jobId}`);
    }
    await hit.agent.deleteJob(jobId);
    return true;
  }

  async toggleJobsByAgent(agentId: string, enabled: boolean): Promise<number> {
    if (!this.context.profile) {
      logger.warn({ msg: 'Skipped agent job toggle without active profile', agentId, enabled });
      return 0;
    }
    const flat = await this.context.profile.listJobsFlat({ agentId });
    let toggled = 0;
    for (const { job } of flat) {
      if (job.config.enabled === enabled) {
        continue;
      }
      try {
        await this.toggleJob(job.id, enabled);
        toggled += 1;
      } catch (error) {
        logger.warn({ msg: 'Failed to toggle job for agent', profileId: this.context.profileId, agentId, jobId: job.id, enabled, err: error });
      }
    }
    logger.info({ msg: 'Toggled jobs for agent', profileId: this.context.profileId, agentId, enabled, toggledCount: toggled });
    return toggled;
  }

  async listJobs(agentId?: string): Promise<SchedulerJob[]> {
    return this.context.listJobs(agentId);
  }

  async getJob(jobId: string): Promise<SchedulerJob | null> {
    return this.context.getJob(jobId);
  }

  async updateJob(jobId: string, updates: SchedulerJobUpdate): Promise<boolean> {
    const profile = this.context.requireProfile();

    try {
      const hit = await profile.findJob(jobId);
      if (!hit) {
        throw new Error(`Schedule job not found: ${jobId}`);
      }
      hit.job.applyUpdate(toPersistScheduleJobUpdate(updates));
      await hit.job.persist();
      const schedulerJob = toSchedulerJob(hit.job.toFile(), hit.job.config.runState);

      this.taskRuntime.unregisterTask(jobId, 'update-job');
      if (schedulerJob.enabled) {
        await this.taskRuntime.registerJob(schedulerJob);
      }
      return true;
    } catch (error) {
      logger.warn({ msg: 'Failed to update job', profileId: this.context.profileId, jobId, err: error });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async toggleJob(jobId: string, enabled: boolean): Promise<boolean> {
    const profile = this.context.requireProfile();

    try {
      const hit = await profile.findJob(jobId);
      if (!hit) {
        throw new Error(`Schedule job not found: ${jobId}`);
      }
      hit.job.applyUpdate({ enabled });
      await hit.job.persist();
      const schedulerJob = toSchedulerJob(hit.job.toFile(), hit.job.config.runState);

      this.taskRuntime.unregisterTask(jobId, enabled ? 'toggle-enable-replace-existing' : 'toggle-disable');
      if (schedulerJob.enabled) {
        await this.taskRuntime.registerJob(schedulerJob);
      }
      return true;
    } catch (error) {
      logger.warn({ msg: 'Failed to toggle job', profileId: this.context.profileId, jobId, enabled, err: error });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async runJobNow(jobId: string, force?: boolean): Promise<SchedulerExecutionResult> {
    if (!this.context.profile) {
      return { success: false, error: 'Scheduler is not initialized for the current user.' };
    }

    const job = await this.context.getJob(jobId);
    if (!job) {
      return { success: false, error: `Schedule job not found: ${jobId}` };
    }
    if (!force && !job.enabled) {
      return { success: false, error: 'Only enabled schedules can be triggered by the agent.' };
    }

    logger.info({ msg: 'Started manual job execution', profileId: this.context.profileId, jobId: job.id, name: job.name, agentId: job.agentId, scheduleType: job.scheduleType });
    return await new Promise<SchedulerExecutionResult>((resolve) => {
      let resolved = false;
      void executeSchedulerJob({
        job,
        triggerSource: 'manual',
        context: this.context,
        taskRuntime: this.taskRuntime,
        onReady: (readyPayload) => {
          if (resolved) {
            return;
          }
          resolved = true;
          resolve({ success: true, chatSessionId: readyPayload.chatSessionId });
        },
      }).then((result) => {
        if (!result.success) {
          logger.warn({ msg: 'Manual job execution failed', profileId: this.context.profileId, jobId: job.id, name: job.name, err: result.error || 'Unknown error' });
        }
        if (resolved) {
          return;
        }
        resolved = true;
        resolve(result);
      });
    });
  }

  async handleSystemResume(suspendedAtMs: number, resumedAtMs: number): Promise<void> {
    await this.catchUp.handleSystemResume(suspendedAtMs, resumedAtMs);
  }

  async dispose(reason: SchedulerDisposeReason = 'unknown'): Promise<void> {
    const activeJobIds = this.taskRuntime.getActiveJobIds();
    logger.info({ msg: 'Started disposal', reason, profileId: this.context.profileId, schedulerGeneration: this.context.generation, activeTaskCountBefore: activeJobIds.length, activeJobIdsBefore: activeJobIds, taskRuntimeMetaSnapshot: this.getRuntimeDiagnostics().taskRuntimeMetaSnapshot });

    if (this.context.profile) {
      try {
        await this.context.profile.schedulerState.markDeactivated(new Date().toISOString());
      } catch (error) {
        logger.warn({ msg: 'Failed to mark profile inactive', profileId: this.context.profileId, err: error });
      }
    }

    this.taskRuntime.stopHeartbeat();
    this.taskRuntime.clearActiveTasks(reason === 'unknown' ? 'dispose' : reason);
    this.context.profile = null;
    logger.info({ msg: 'Finished disposal', reason, schedulerGeneration: this.context.generation, activeTaskCountAfter: this.taskRuntime.getActiveTaskCount() });
  }
}

export const schedulerManager = new SchedulerManager();
