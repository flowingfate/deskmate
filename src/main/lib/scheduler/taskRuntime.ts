import * as cron from 'node-cron';
import { log } from '@main/log';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import type { SchedulerContext } from './context';
import { runCronWatchdog } from './cronWatchdog';
import type {
  ActiveTask,
  SchedulerJobExecutor,
  SchedulerRuntimeDiagnostics,
  SchedulerTaskRuntimeMeta,
  SchedulerTaskUnregisterReason,
} from './types';

const logger = log.child({ mod: 'SchedulerTaskRuntime' });
const MAX_TIMEOUT_MS = 2_147_483_647;
const HEARTBEAT_INTERVAL_MS = 60_000;

type CronSchedulerJob = Extract<SchedulerJob, { scheduleType: 'cron' }>;
type OneTimeSchedulerJob = Extract<SchedulerJob, { scheduleType: 'once' }>;

/**
 * 注册 / 注销 node-cron 与 setTimeout 任务，维护运行时诊断 meta 与心跳看门狗。
 * 活动状态（profile / generation）从共享的 SchedulerContext 读取；触发时直接执行任务。
 */
export class SchedulerTaskRuntime {
  private readonly activeTasks: Map<string, ActiveTask> = new Map();
  private readonly taskRuntimeMeta: Map<string, SchedulerTaskRuntimeMeta> = new Map();
  private taskSequence = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly context: SchedulerContext,
    private readonly executeJob: SchedulerJobExecutor,
  ) {}

  getRuntimeDiagnostics(): SchedulerRuntimeDiagnostics {
    const activeJobIds = Array.from(this.activeTasks.keys());
    return {
      profileId: this.context.profileId,
      schedulerGeneration: this.context.generation,
      activeTaskCount: this.activeTasks.size,
      activeJobIds,
      taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(activeJobIds),
    };
  }

  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  getActiveJobIds(): string[] {
    return Array.from(this.activeTasks.keys());
  }

  getTaskRuntimeMeta(jobId: string): SchedulerTaskRuntimeMeta | undefined {
    return this.taskRuntimeMeta.get(jobId);
  }

  setTaskRuntimeMeta(jobId: string, meta: SchedulerTaskRuntimeMeta): void {
    this.taskRuntimeMeta.set(jobId, meta);
  }

  async registerJob(job: SchedulerJob): Promise<void> {
    const trigger = job.scheduleType === 'cron' ? job.cronExpression : job.runAt;
    logger.info({ msg: 'Registering task', profileId: this.context.profileId, schedulerGeneration: this.context.generation, jobId: job.id, name: job.name, scheduleType: job.scheduleType, trigger, enabled: job.enabled, lastStartedAt: job.lastStartedAt });

    if (job.scheduleType === 'once') {
      await this.registerOneTimeTask(job);
      return;
    }

    this.registerCronTask(job);
  }

  unregisterTask(jobId: string, reason: SchedulerTaskUnregisterReason): void {
    const activeTask = this.activeTasks.get(jobId);
    if (!activeTask) {
      return;
    }

    const previousRuntimeMeta = this.taskRuntimeMeta.get(jobId);
    logger.info({ msg: 'Unregistering task', jobId, reason, profileId: this.context.profileId, schedulerGeneration: previousRuntimeMeta?.schedulerGeneration ?? this.context.generation, previousRuntimeMeta: previousRuntimeMeta ? { ...previousRuntimeMeta } : null });

    if (activeTask.kind === 'cron') {
      activeTask.task.stop();
    } else {
      clearTimeout(activeTask.timer);
    }

    this.activeTasks.delete(jobId);
    this.taskRuntimeMeta.delete(jobId);
    if (activeTask.kind === 'cron' && !this.hasActiveCronTasks()) {
      this.stopHeartbeat();
    }

    logger.info({ msg: 'Unregistered task', jobId, reason, profileId: this.context.profileId, schedulerGeneration: previousRuntimeMeta?.schedulerGeneration ?? this.context.generation, activeTaskCountAfter: this.activeTasks.size });
  }

  clearActiveTasks(reason: SchedulerTaskUnregisterReason): void {
    const jobIds = this.getActiveJobIds();
    logger.info({ msg: 'Clearing active tasks', profileId: this.context.profileId, reason, count: jobIds.length, jobIds, schedulerGeneration: this.context.generation, taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(jobIds) });

    for (const jobId of this.activeTasks.keys()) {
      this.unregisterTask(jobId, reason);
    }

    logger.info({ msg: 'Cleared active tasks', profileId: this.context.profileId, reason, count: this.activeTasks.size, schedulerGeneration: this.context.generation });
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const schedulerGeneration = this.context.generation;
      const cronJobIds = Array.from(this.activeTasks.entries())
        .filter(([, task]) => task.kind === 'cron')
        .map(([jobId]) => jobId);
      if (cronJobIds.length === 0) {
        return;
      }

      void runCronWatchdog({
        profileId: this.context.profileId,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        cronJobIds,
        getRuntimeMeta: (jobId): SchedulerTaskRuntimeMeta | undefined => (
          this.context.isCurrentGeneration(schedulerGeneration)
            ? this.taskRuntimeMeta.get(jobId)
            : undefined
        ),
        setRuntimeMeta: (jobId, meta): void => {
          if (!this.context.isCurrentGeneration(schedulerGeneration)) {
            return;
          }
          const current = this.taskRuntimeMeta.get(jobId);
          if (current) {
            this.taskRuntimeMeta.set(jobId, {
              ...current,
              ...meta,
            });
          }
        },
        getJob: async (jobId: string): Promise<SchedulerJob | null> => (
          this.context.isCurrentGeneration(schedulerGeneration)
            ? this.context.getJob(jobId)
            : null
        ),
        executeJob: async (job: SchedulerJob): Promise<void> => {
          await this.executeJob({
            job,
            triggerSource: 'watchdog-catchup',
            expectedGeneration: schedulerGeneration,
          });
        },
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private registerCronTask(job: CronSchedulerJob): void {
    const previousMeta = this.taskRuntimeMeta.get(job.id);
    logger.info({ msg: 'Replacing cron task', profileId: this.context.profileId, schedulerGeneration: this.context.generation, jobId: job.id, name: job.name, cronExpression: job.cronExpression, hadExistingTask: this.activeTasks.has(job.id), previousRuntimeMeta: previousMeta ? { ...previousMeta } : null });
    this.unregisterTask(job.id, 're-register-before-cron-register');

    const runtimeMeta = this.createTaskRuntimeMeta(job, 'cron');
    let task: cron.ScheduledTask | null = null;
    task = cron.schedule(job.cronExpression, async (): Promise<void> => {
      const activeTask = this.activeTasks.get(job.id);
      const currentMeta = this.taskRuntimeMeta.get(job.id);
      if (
        task === null
        || activeTask?.kind !== 'cron'
        || activeTask.task !== task
        || currentMeta?.schedulerGeneration !== runtimeMeta.schedulerGeneration
        || currentMeta.taskSequence !== runtimeMeta.taskSequence
      ) {
        logger.info({ msg: 'Skipped stale cron tick', jobId: job.id, taskSequence: runtimeMeta.taskSequence });
        return;
      }

      const firedAt = new Date().toISOString();
      this.taskRuntimeMeta.set(job.id, { ...currentMeta, lastTickArrivedAt: firedAt });
      const latestJob = await this.context.getJob(job.id);
      const latestTask = this.activeTasks.get(job.id);
      const latestMeta = this.taskRuntimeMeta.get(job.id);
      if (
        latestTask?.kind !== 'cron'
        || latestTask.task !== task
        || latestMeta?.schedulerGeneration !== runtimeMeta.schedulerGeneration
        || latestMeta.taskSequence !== runtimeMeta.taskSequence
        || !latestJob
        || !latestJob.enabled
        || latestJob.scheduleType !== 'cron'
      ) {
        logger.info({ msg: 'Skipped inactive cron tick', jobId: job.id, firedAt });
        return;
      }

      logger.info({ msg: 'Dispatching cron job execution', jobId: job.id, profileId: this.context.profileId, schedulerGeneration: runtimeMeta.schedulerGeneration, taskSequence: runtimeMeta.taskSequence, firedAt });
      await this.executeJob({
        job: latestJob,
        triggerSource: 'scheduled',
        expectedGeneration: runtimeMeta.schedulerGeneration,
      });
    });

    this.activeTasks.set(job.id, { kind: 'cron', task });
    runtimeMeta.lastCronWatchdogCheckedAt = runtimeMeta.registeredAt;
    this.taskRuntimeMeta.set(job.id, runtimeMeta);
    if (!this.heartbeatTimer) {
      this.startHeartbeat();
    }
    logger.info({ msg: 'Registered cron task', jobId: job.id, name: job.name, profileId: this.context.profileId, cronExpression: job.cronExpression, schedulerGeneration: runtimeMeta.schedulerGeneration, taskSequence: runtimeMeta.taskSequence, registeredAt: runtimeMeta.registeredAt, activeTaskCountAfter: this.activeTasks.size, activeTaskKeysAfter: this.getActiveJobIds() });
  }

  private async registerOneTimeTask(job: OneTimeSchedulerJob): Promise<void> {
    const runAtMs = Date.parse(job.runAt);
    if (Number.isNaN(runAtMs)) {
      logger.warn({ msg: 'Invalid one-time task run time', jobId: job.id, name: job.name, runAt: job.runAt, schedulerGeneration: this.context.generation });
      return;
    }

    const delayMs = runAtMs - Date.now();
    if (delayMs <= 0) {
      await this.markOneTimeJobExpired(job.id);
      return;
    }

    const previousMeta = this.taskRuntimeMeta.get(job.id);
    logger.info({ msg: 'Replacing one-time task', profileId: this.context.profileId, schedulerGeneration: this.context.generation, jobId: job.id, name: job.name, runAt: job.runAt, hadExistingTask: this.activeTasks.has(job.id), previousRuntimeMeta: previousMeta ? { ...previousMeta } : null });
    const schedulerGeneration = this.context.generation;
    this.unregisterTask(job.id, 're-register-before-once-register');

    const scheduleTimeout = (remainingMs: number): void => {
      const nextDelayMs = Math.min(remainingMs, MAX_TIMEOUT_MS);
      const timer = setTimeout(async (): Promise<void> => {
        const activeTask = this.activeTasks.get(job.id);
        if (activeTask?.kind !== 'timeout' || activeTask.timer !== timer) {
          return;
        }

        if (remainingMs > MAX_TIMEOUT_MS) {
          await this.registerOneTimeTask(job);
          return;
        }

        this.unregisterTask(job.id, 'once-job-fired');
        const latestJob = await this.context.getJob(job.id);
        if (!latestJob || !latestJob.enabled || latestJob.scheduleType !== 'once') {
          return;
        }
        await this.executeJob({
          job: latestJob,
          triggerSource: 'scheduled',
          expectedGeneration: schedulerGeneration,
        });
      }, nextDelayMs);
      this.activeTasks.set(job.id, { kind: 'timeout', timer });
    };

    scheduleTimeout(delayMs);
    const runtimeMeta = this.createTaskRuntimeMeta(job, 'timeout');
    this.taskRuntimeMeta.set(job.id, runtimeMeta);
    logger.info({ msg: 'Registered one-time task', jobId: job.id, name: job.name, runAt: job.runAt, delayMs, profileId: this.context.profileId, schedulerGeneration: runtimeMeta.schedulerGeneration, taskSequence: runtimeMeta.taskSequence });
  }

  /** once 任务在触发时已过期（runAt 落在过去）：注销 timer 并把 job 落盘置为 disabled。 */
  private async markOneTimeJobExpired(jobId: string): Promise<void> {
    const store = this.context.store
    this.unregisterTask(jobId, 'once-job-expired');
    const hit = await store.findJob(jobId);
    if (hit) {
      hit.job.applyUpdate({ enabled: false });
      await hit.job.persist();
    }
    logger.info({ msg: 'Expired one-time task before execution', jobId });
  }

  private hasActiveCronTasks(): boolean {
    for (const task of this.activeTasks.values()) {
      if (task.kind === 'cron') {
        return true;
      }
    }
    return false;
  }

  private createTaskRuntimeMeta(
    job: SchedulerJob,
    taskKind: ActiveTask['kind'],
  ): SchedulerTaskRuntimeMeta {
    this.taskSequence += 1;
    return {
      jobId: job.id,
      profileId: this.context.profileId,
      schedulerGeneration: this.context.generation,
      taskSequence: this.taskSequence,
      taskKind,
      registeredAt: new Date().toISOString(),
      cronExpression: job.scheduleType === 'cron' ? job.cronExpression : undefined,
      runAt: job.scheduleType === 'once' ? job.runAt : undefined,
    };
  }

  private getTaskRuntimeMetaSnapshot(jobIds: string[]): SchedulerTaskRuntimeMeta[] {
    return jobIds
      .map((jobId) => this.taskRuntimeMeta.get(jobId))
      .filter((meta): meta is SchedulerTaskRuntimeMeta => meta !== undefined)
      .map((meta) => ({ ...meta }));
  }
}
