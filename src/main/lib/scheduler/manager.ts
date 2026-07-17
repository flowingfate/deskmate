/**
 * SchedulerManager coordinates scheduler persistence, runtime registration, and execution.
 * Schedule settings remain owned by the profile persistence layer.
 *
 * SchedulerContext 固定绑定创建它的 ProfileStore；运行时不再切换 profile。
 * taskRuntime / catchUp 按引用共享同一份 context。
 */

import { log } from '@main/log';
import type { ProfileStore } from '@main/persist';
import type { JobRun } from '@main/pi';
import type { SchedulerJob, SchedulerJobCreateInput, SchedulerJobUpdate } from '@shared/ipc/scheduler';
import { SchedulerCatchUp } from './catchUp';
import { SchedulerContext } from './context';
import { executeSchedulerJob } from './execution';
import { SchedulerTaskRuntime } from './taskRuntime';
import { toPersistScheduleJobUpdate, toSchedulerJob, toScheduleJobInput } from './jobAdapter';
import type {
  SchedulerDisposeReason,
  SchedulerExecutionResult,
  SchedulerJobExecution,
  SchedulerRuntimeDiagnostics,
} from './types';

const logger = log.child({ mod: 'SchedulerManager' });

type ActiveSchedulerExecution = {
  run: JobRun | null;
  done: Promise<void>;
  complete: () => void;
};


export class SchedulerManager {
  private readonly context: SchedulerContext;
  private readonly taskRuntime: SchedulerTaskRuntime;
  private readonly catchUp: SchedulerCatchUp;
  private readonly activeExecutions = new Set<ActiveSchedulerExecution>();

  public constructor(store: ProfileStore) {
    this.context = new SchedulerContext(store);
    const executeJob = (execution: SchedulerJobExecution): Promise<SchedulerExecutionResult> => (
      this.executeTrackedJob(execution)
    );
    this.taskRuntime = new SchedulerTaskRuntime(this.context, executeJob);
    this.catchUp = new SchedulerCatchUp(this.context, executeJob);
  }

  getRuntimeDiagnostics(): SchedulerRuntimeDiagnostics {
    return this.taskRuntime.getRuntimeDiagnostics();
  }

  /** 启动本 Profile 的任务登记；重复调用保持幂等。 */
  async start(): Promise<void> {
    if (this.context.isStarted) return;

    const schedulerGeneration = this.context.activate();
    const startupAtMs = Date.now();
    const startupAtIso = new Date(startupAtMs).toISOString();
    const activeJobIdsBefore = this.taskRuntime.getActiveJobIds();
    this.taskRuntime.clearActiveTasks('start-clear');

    logger.info({
      msg: 'Started scheduler',
      profileId: this.context.profileId,
      schedulerGeneration,
      activeJobIdsBefore,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
    });

    try {
      await this.catchUp.recoverInterruptedScheduledSessions();
      logger.info({
        msg: 'Completed interrupted-run recovery',
        profileId: this.context.profileId,
        schedulerGeneration,
      });

      let baselineSnapshot: {
        isActive: boolean;
        lastActivatedAt?: string;
        lastDeactivatedAt?: string;
      } | null = null;
      let pendingSnapshot: Record<string, { occurrenceAt: string; recordedAt: string }> = {};
      try {
        await this.context.store.schedulerState.load();
        baselineSnapshot = this.context.store.schedulerState.getBaseline();
        pendingSnapshot = this.context.store.schedulerState.getPending();
        await this.context.store.schedulerState.markActivated(startupAtIso);
      } catch (error) {
        logger.warn({
          msg: 'Failed to load scheduler state',
          profileId: this.context.profileId,
          err: error,
        });
      }

      const jobs = await this.context.listJobs();
      const enabledJobs = jobs.filter((job) => job.enabled);
      const cronJobs = enabledJobs.filter((job) => job.scheduleType === 'cron').length;
      const oneTimeJobs = enabledJobs.filter((job) => job.scheduleType === 'once').length;
      logger.info({
        msg: 'Loaded jobs',
        profileId: this.context.profileId,
        schedulerGeneration,
        totalJobs: jobs.length,
        enabledJobs: enabledJobs.length,
        disabledJobs: jobs.length - enabledJobs.length,
        enabledCronJobs: cronJobs,
        enabledOneTimeJobs: oneTimeJobs,
        enabledJobIds: enabledJobs.map((job) => job.id),
      });

      let registrationFailures = 0;
      for (const job of enabledJobs) {
        try {
          await this.taskRuntime.registerJob(job);
        } catch (error) {
          registrationFailures += 1;
          logger.warn({
            msg: 'Failed to register job',
            profileId: this.context.profileId,
            schedulerGeneration,
            jobId: job.id,
            name: job.name,
            scheduleType: job.scheduleType,
            err: error,
          });
        }
      }

      logger.info({
        msg: 'Finished scheduler start',
        profileId: this.context.profileId,
        schedulerGeneration,
        totalJobs: jobs.length,
        enabledJobs: enabledJobs.length,
        registrationFailures,
        activeTasks: this.taskRuntime.getActiveTaskCount(),
        activeJobIds: this.taskRuntime.getActiveJobIds(),
      });
      this.taskRuntime.startHeartbeat();
      void this.catchUp.handleColdStartCatchUp(
        startupAtMs,
        jobs,
        baselineSnapshot,
        pendingSnapshot,
        schedulerGeneration,
      ).catch((error) => {
        logger.warn({
          msg: 'Cold-start catch-up failed',
          profileId: this.context.profileId,
          schedulerGeneration,
          err: error,
        });
      });
    } catch (error) {
      logger.warn({
        msg: 'Scheduler start failed',
        profileId: this.context.profileId,
        schedulerGeneration,
        err: error,
        activeTasks: this.taskRuntime.getActiveTaskCount(),
        activeJobIds: this.taskRuntime.getActiveJobIds(),
      });
    }
  }

  async createJob(job: SchedulerJobCreateInput): Promise<string> {
    const store = this.context.store;

    try {
      const agent = await store.getAgent(job.agentId);
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
    const store = this.context.store;

    this.taskRuntime.unregisterTask(jobId, 'delete-job');
    const hit = await store.findJob(jobId);
    if (!hit) {
      throw new Error(`Schedule job not found: ${jobId}`);
    }
    await hit.agent.deleteJob(jobId);
    return true;
  }

  async toggleJobsByAgent(agentId: string, enabled: boolean): Promise<number> {
    const flat = await this.context.store.listJobsFlat({ agentId });
    let toggled = 0;
    for (const { job } of flat) {
      if (job.config.enabled === enabled) continue;
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
    const store = this.context.store;

    try {
      const hit = await store.findJob(jobId);
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
    const store = this.context.store;

    try {
      const hit = await store.findJob(jobId);
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
    if (!this.context.isStarted) {
      return { success: false, error: 'Scheduler is not running for this profile.' };
    }

    const job = await this.context.getJob(jobId);
    if (!job) {
      return { success: false, error: `Schedule job not found: ${jobId}` };
    }
    if (!force && !job.enabled) {
      return { success: false, error: 'Only enabled schedules can be triggered by the agent.' };
    }

    logger.info({ msg: 'Started manual job execution', profileId: this.context.profileId, jobId: job.id, name: job.name, agentId: job.agentId, scheduleType: job.scheduleType });
    return new Promise<SchedulerExecutionResult>((resolve) => {
      let resolved = false;
      void this.executeTrackedJob({
        job,
        triggerSource: 'manual',
      }, (readyPayload) => {
        if (resolved) return;
        resolved = true;
        resolve({ success: true, chatSessionId: readyPayload.chatSessionId });
      }).then((result) => {
        if (!result.success) {
          logger.warn({ msg: 'Manual job execution failed', profileId: this.context.profileId, jobId: job.id, name: job.name, err: result.error || 'Unknown error' });
        }
        if (resolved) return;
        resolved = true;
        resolve(result);
      });
    });
  }

  private async executeTrackedJob(
    execution: SchedulerJobExecution,
    onReady?: (payload: { chatSessionId: string }) => void,
  ): Promise<SchedulerExecutionResult> {
    if (!this.context.isStarted) {
      return { success: false, error: 'Scheduler is not running for this profile.' };
    }

    const completion = Promise.withResolvers<void>();
    const active: ActiveSchedulerExecution = {
      run: null,
      done: completion.promise,
      complete: () => completion.resolve(),
    };
    this.activeExecutions.add(active);

    try {
      return await executeSchedulerJob({
        ...execution,
        context: this.context,
        taskRuntime: this.taskRuntime,
        onReady,
        onRunCreated: (run) => {
          active.run = run;
        },
      });
    } finally {
      this.activeExecutions.delete(active);
      active.complete();
    }
  }

  private async cancelActiveExecutions(): Promise<void> {
    const active = [...this.activeExecutions];
    await Promise.allSettled(active.flatMap(({ run }) => run ? [run.abort()] : []));
    await Promise.allSettled(active.map(({ done }) => done));
  }

  async handleSystemResume(suspendedAtMs: number, resumedAtMs: number): Promise<void> {
    if (!this.context.isStarted) return;
    await this.catchUp.handleSystemResume(suspendedAtMs, resumedAtMs);
  }

  async dispose(reason: SchedulerDisposeReason = 'unknown'): Promise<void> {
    const activeJobIds = this.taskRuntime.getActiveJobIds();
    const wasStarted = this.context.isStarted;
    logger.info({ msg: 'Started disposal', reason, profileId: this.context.profileId, schedulerGeneration: this.context.generation, activeTaskCountBefore: activeJobIds.length, activeJobIdsBefore: activeJobIds, taskRuntimeMetaSnapshot: this.getRuntimeDiagnostics().taskRuntimeMetaSnapshot });

    this.context.deactivate();
    this.taskRuntime.stopHeartbeat();
    this.taskRuntime.clearActiveTasks(reason === 'unknown' ? 'dispose' : reason);
    await this.cancelActiveExecutions();

    if (wasStarted) {
      try {
        await this.context.store.schedulerState.markDeactivated(new Date().toISOString());
      } catch (error) {
        logger.warn({ msg: 'Failed to mark profile inactive', profileId: this.context.profileId, err: error });
      }
    }

    logger.info({ msg: 'Finished disposal', reason, profileId: this.context.profileId, schedulerGeneration: this.context.generation, activeTaskCountAfter: this.taskRuntime.getActiveTaskCount() });
  }
}

