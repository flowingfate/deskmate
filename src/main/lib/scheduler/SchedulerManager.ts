/**
 * SchedulerManager - Scheduled task runtime manager
 *
 * Responsible only for runtime registration and execution.
 * Schedule settings source of truth is owned by ScheduleStore.
 */

import * as cron from 'node-cron';
import { log } from '@main/log';
import { SchedulerJob, type ScheduleJobCreateInput } from './types';
import { Profiles, type Profile } from '@main/persist';
import { JobRun } from '@main/pi';
import { showSessionCompletionNotification } from '@main/lib/notification/sessionCompletion';
import { createUserMessage } from '@shared/utils/messageFactory';
import { toPersistScheduleJobUpdate, toSchedulerJob, toScheduleJobInput } from './jobAdapter';
import {
  findMissedCronOccurrence,
  getColdStartCatchUpBaseline,
  getSchedulerTimeZone,
  MAX_RESUME_CATCH_UP_DELAY_MS,
  shouldCatchUpMissedOccurrence,
} from './cronRecovery';
import { runCronWatchdog } from './cronWatchdog';

const logger = log;
const MAX_TIMEOUT_MS = 2_147_483_647;

type ActiveTask =
  | { kind: 'cron'; task: cron.ScheduledTask }
  | { kind: 'timeout'; timer: ReturnType<typeof setTimeout> };

type SchedulerTaskRuntimeMeta = {
  jobId: string;
  profileId: string | null;
  schedulerGeneration: number;
  taskSequence: number;
  taskKind: ActiveTask['kind'];
  registeredAt: string;
  cronExpression?: string;
  runAt?: string;
  lastTickArrivedAt?: string;
  lastCronWatchdogCheckedAt?: string;
  lastCronWatchdogCatchUpAt?: string;
  lastExecuteStartAt?: string;
  lastExecuteEndAt?: string;
  lastExecuteOutcome?: 'success' | 'failed';
  unregisteredAt?: string;
  lastUnregisterReason?: string;
};

type SchedulerExecutionResult = {
  success: boolean;
  chatSessionId?: string;
  messagesCount?: number;
  error?: string;
};

type SchedulerDisposeReason =
  | 'app-quit'
  | 'updater-handoff'
  | 'auth-destroy-current-session'
  | 'profile-switch'
  | 'window-close'
  | 'manual-debug'
  | 'unknown';

type SchedulerTaskUnregisterReason =
  | 're-register-before-cron-register'
  | 're-register-before-once-register'
  | 'initialize-clear'
  | 'dispose'
  | 'app-quit'
  | 'updater-handoff'
  | 'auth-destroy-current-session'
  | 'toggle-disable'
  | 'toggle-enable-replace-existing'
  | 'update-job'
  | 'delete-job'
  | 'once-job-fired'
  | 'once-job-completed'
  | 'once-job-failed'
  | 'once-job-expired'
  | 'profile-switch'
  | 'window-close'
  | 'manual-debug'
  | 'unknown';

type SchedulerRuntimeDiagnostics = {
  profileId: string | null;
  schedulerGeneration: number;
  activeTaskCount: number;
  activeJobIds: string[];
  taskRuntimeMetaSnapshot: SchedulerTaskRuntimeMeta[];
};

export class SchedulerManager {
  private static instance: SchedulerManager;

  private static readonly HEARTBEAT_INTERVAL_MS = 60_000;

  /** Active scheduled tasks: jobId -> task handle */
  private activeTasks: Map<string, ActiveTask> = new Map();

  /** 当前 active profile id。null 表示未登录 / scheduler 未初始化。 */
  private currentProfileId: string | null = null;

  /** 缓存 active Profile 实例，避免反复 await Profiles.active()。与 currentProfileId 同生命周期。 */
  private currentProfile: Profile | null = null;

  private schedulerGeneration = 0;

  private taskSequence = 0;

  private taskRuntimeMeta: Map<string, SchedulerTaskRuntimeMeta> = new Map();

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  static getInstance(): SchedulerManager {
    if (!SchedulerManager.instance) {
      SchedulerManager.instance = new SchedulerManager();
    }
    return SchedulerManager.instance;
  }

  /** 当前 active profile id。null 表示未登录 / 未初始化。 */
  getProfileId(): string | null {
    return this.currentProfileId;
  }

  /**
   * persist 重构 step5 PR3：所有 CRUD 路径的统一 profile 取数入口。
   * 没缓存就抛——initialize 必先于 CRUD 跑过；调不到说明上游时序 bug。
   */
  private requireProfile(): Profile {
    if (!this.currentProfile) {
      throw new Error('Scheduler is not initialized for the current user.');
    }
    return this.currentProfile;
  }

  getRuntimeDiagnostics(): SchedulerRuntimeDiagnostics {
    const activeJobIds = Array.from(this.activeTasks.keys());
    return {
      profileId: this.currentProfileId,
      schedulerGeneration: this.schedulerGeneration,
      activeTaskCount: this.activeTasks.size,
      activeJobIds,
      taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(activeJobIds),
    };
  }

  /**
   * Initialize runtime tasks for the given active profile.
   *
   * 时序：
   *   1. 切 profile（若不同则先 markDeactivated 老 profile 的 schedulerState）
   *   2. recoverInterruptedScheduledSessions（扫 running runs 标 failed）
   *   3. 拿 baseline 快照（先于 markActivated，否则窗口=now）
   *   4. markActivated（写 isActive=true + lastActivatedAt）
   *   5. handleColdStartCatchUp（基于 baseline 算 missed + 出队 pending）
   *   6. 注册所有 enabled job
   *   7. startHeartbeat
   */
  async initialize(profileId: string): Promise<void> {
    const previousProfileId = this.currentProfileId;
    const previousGeneration = this.schedulerGeneration;
    this.schedulerGeneration += 1;
    const schedulerGeneration = this.schedulerGeneration;
    const previousActiveTasks = this.activeTasks.size;
    const activeJobIdsBefore = Array.from(this.activeTasks.keys());
    const startupAtMs = Date.now();
    const startupAtIso = new Date(startupAtMs).toISOString();

    // 切 profile：先把上一个 profile 的 schedulerState 标记为 deactivated（clean-exit baseline）
    if (this.currentProfile && this.currentProfileId !== profileId) {
      try {
        await this.currentProfile.schedulerState.markDeactivated(startupAtIso);
      } catch (err) {
        logger.warn({ msg: 'scheduler.initialize.mark-previous-deactivated-failed', mod: 'initialize', previousProfileId: this.currentProfileId, err });
      }
    }

    this.clearActiveTasks(previousProfileId && previousProfileId !== profileId ? 'profile-switch' : 'initialize-clear');

    // 接入 active Profile。Profiles.bootstrap 由 startup 早期统一入口负责，到这里必然已 ready。
    try {
      const profile = await Profiles.get().active();
      if (profile.id !== profileId) {
        logger.warn({ msg: 'scheduler.initialize.profile-id-mismatch', mod: 'initialize', expected: profileId, actual: profile.id });
      }
      this.currentProfile = profile;
      this.currentProfileId = profile.id;
    } catch (err) {
      logger.warn({ msg: 'scheduler.initialize.persist-active-failed', mod: 'initialize', profileId, err });
      this.currentProfile = null;
      this.currentProfileId = null;
    }

    logger.info({ msg: 'scheduler.initialize.start', mod: 'initialize', profileId: this.currentProfileId, previousProfileId, schedulerGeneration, previousGeneration, activeTaskCountBefore: previousActiveTasks, activeJobIdsBefore, pid: process.pid, uptimeMs: Math.round(process.uptime() * 1000) });

    try {
      await this.recoverInterruptedScheduledSessions();
      logger.info({ msg: 'scheduler.recover-interrupted.end', mod: 'initialize', profileId: this.currentProfileId, schedulerGeneration });

      // step5 PR5b：cold-start catchup 接回，状态走 Profile.schedulerState（PersistBase 防抖写盘）。
      // 必须先抓 baseline / pending 快照，再 markActivated —— 否则 lastActivatedAt 已被覆写为 now，
      // 算 missed occurrence 的窗口会塌缩为零。
      let baselineSnapshot: { isActive: boolean; lastActivatedAt?: string; lastDeactivatedAt?: string } | null = null;
      let pendingSnapshot: Record<string, { occurrenceAt: string; recordedAt: string }> = {};
      if (this.currentProfile) {
        try {
          await this.currentProfile.schedulerState.load();
          baselineSnapshot = this.currentProfile.schedulerState.getBaseline();
          pendingSnapshot = this.currentProfile.schedulerState.getPending();
          await this.currentProfile.schedulerState.markActivated(startupAtIso);
        } catch (err) {
          logger.warn({ msg: 'scheduler.initialize.scheduler-state-load-failed', mod: 'initialize', profileId: this.currentProfileId, err });
        }
      }

      const jobs = await this.listJobs();
      const enabledJobs = jobs.filter((job) => job.enabled);
      const cronJobs = enabledJobs.filter((job) => job.scheduleType === 'cron').length;
      const oneTimeJobs = enabledJobs.filter((job) => job.scheduleType === 'once').length;

      logger.info({ msg: 'scheduler.initialize.jobs-loaded', mod: 'initialize', profileId: this.currentProfileId, schedulerGeneration, totalJobs: jobs.length, enabledJobs: enabledJobs.length, disabledJobs: jobs.length - enabledJobs.length, enabledCronJobs: cronJobs, enabledOneTimeJobs: oneTimeJobs, enabledJobIds: enabledJobs.map((job) => job.id), enabledJobSnapshots: enabledJobs.map((job) => ({
                      jobId: job.id,
                      name: job.name,
                      scheduleType: job.scheduleType,
                      cronExpression: job.cronExpression,
                      runAt: job.runAt,
                      enabled: job.enabled,
                      status: job.status,
                      lastRunAt: job.lastRunAt,
                    })) });

      await this.handleColdStartCatchUp(startupAtMs, jobs, baselineSnapshot, pendingSnapshot);

      for (const job of jobs) {
        if (job.enabled) {
          try {
            await this.registerJob(job);
          } catch (error) {
            logger.warn({ msg: 'scheduler.initialize.register-job-failed', mod: 'initialize', profileId: this.currentProfileId, schedulerGeneration, jobId: job.id, name: job.name, scheduleType: job.scheduleType, err: error });
            throw error;
          }
        }
      }

      logger.info({ msg: 'scheduler.initialize.end', mod: 'initialize', profileId: this.currentProfileId, schedulerGeneration, totalJobs: jobs.length, enabledJobs: enabledJobs.length, activeTasks: this.activeTasks.size, activeJobIds: Array.from(this.activeTasks.keys()) });

      this.startHeartbeat();
    } catch (error) {
      logger.warn({ msg: 'scheduler.initialize.failed', mod: 'initialize', profileId: this.currentProfileId, schedulerGeneration, err: error, activeTasks: this.activeTasks.size, activeJobIds: Array.from(this.activeTasks.keys()) });
    }
  }

  /** 返回 persist 内生 ULID（`j_*`）。调用方 `id` 字段会被丢弃，因为 jobAdapter 强制 persist 自填。 */
  async createJob(job: ScheduleJobCreateInput): Promise<string> {
    if (!this.currentProfileId) {
      throw new Error('Scheduler is not initialized for the current user.');
    }
    const profile = this.requireProfile();

    try {
      const agent = await profile.getAgent(job.agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${job.agentId}`);
      }
      const input = toScheduleJobInput(job);
      const created = await agent.createJob(input);
      const sj = toSchedulerJob(created.toFile(), created.config.runState);
      if (sj.enabled) {
        await this.registerJob(sj);
      }
      return created.id;
    } catch (error) {
      logger.warn({ msg: 'scheduler.job.create.failed', mod: 'createJob', profileId: this.currentProfileId, agentId: job.agentId, err: error });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async deleteJob(jobId: string): Promise<boolean> {
    if (!this.currentProfileId) {
      throw new Error('Scheduler is not initialized for the current user.');
    }
    const profile = this.requireProfile();

    this.unregisterTask(jobId, 'delete-job');
    const hit = await profile.findJob(jobId);
    if (!hit) {
      throw new Error(`Schedule job not found: ${jobId}`);
    }
    await hit.agent.deleteJob(jobId);
    return true;
  }

  async toggleJobsByAgent(agentId: string, enabled: boolean): Promise<number> {
    if (!this.currentProfileId) {
      logger.warn({ msg: 'scheduler.toggle-jobs-for-agent.skipped-no-profile', mod: 'toggleJobsByAgent', agentId, enabled });
      return 0;
    }
    const profile = this.requireProfile();
    const flat = await profile.listJobsFlat({ agentId });
    let toggled = 0;
    for (const { job } of flat) {
      if (job.config.enabled === enabled) continue;
      try {
        await this.toggleJob(job.id, enabled);
        toggled++;
      } catch (err) {
        logger.warn({ msg: 'scheduler.toggle-job-for-agent.failed', mod: 'toggleJobsByAgent', profileId: this.currentProfileId, agentId, jobId: job.id, enabled, err: err });
      }
    }
    logger.info({ msg: 'scheduler.jobs-toggled-for-agent', mod: 'toggleJobsByAgent', profileId: this.currentProfileId, agentId, enabled, toggledCount: toggled });
    return toggled;
  }

  async listJobs(agentId?: string): Promise<SchedulerJob[]> {
    if (!this.currentProfileId) return [];
    const profile = this.requireProfile();
    const flat = await profile.listJobsFlat(agentId ? { agentId } : undefined);
    return flat.map(({ job }) => toSchedulerJob(job.toFile(), job.config.runState));
  }

  async getJob(jobId: string): Promise<SchedulerJob | null> {
    if (!this.currentProfileId) return null;
    const profile = this.requireProfile();
    const hit = await profile.findJob(jobId);
    if (!hit) return null;
    return toSchedulerJob(hit.job.toFile(), hit.job.config.runState);
  }

  async updateJob(
    jobId: string,
    updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'cronExpression' | 'runAt' | 'description' | 'enabled' | 'scheduleType' | 'status' | 'lastRunAt' | 'executedAt' | 'notifyOnCompletion'>>,
  ): Promise<boolean> {
    if (!this.currentProfileId) {
      throw new Error('Scheduler is not initialized for the current user.');
    }
    const profile = this.requireProfile();

    try {
      const hit = await profile.findJob(jobId);
      if (!hit) {
        throw new Error(`Schedule job not found: ${jobId}`);
      }
      // status / lastRunAt / executedAt 字段属于 runState，外部不允许 mutate。adapter 会丢掉。
      const persistUpdate = toPersistScheduleJobUpdate(hit.job.toFile(), updates);
      hit.job.applyUpdate(persistUpdate);
      await hit.job.persist();
      const sj = toSchedulerJob(hit.job.toFile(), hit.job.config.runState);

      this.unregisterTask(jobId, 'update-job');
      if (sj.enabled) {
        await this.registerJob(sj);
      }
      return true;
    } catch (error) {
      logger.warn({ msg: 'scheduler.job.update.failed', mod: 'updateJob', profileId: this.currentProfileId, jobId, err: error });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async toggleJob(jobId: string, enabled: boolean): Promise<boolean> {
    if (!this.currentProfileId) {
      throw new Error('Scheduler is not initialized for the current user.');
    }
    const profile = this.requireProfile();

    try {
      const hit = await profile.findJob(jobId);
      if (!hit) {
        throw new Error(`Schedule job not found: ${jobId}`);
      }
      hit.job.applyUpdate({ enabled });
      await hit.job.persist();
      const sj = toSchedulerJob(hit.job.toFile(), hit.job.config.runState);

      this.unregisterTask(jobId, enabled ? 'toggle-enable-replace-existing' : 'toggle-disable');
      if (sj.enabled) {
        await this.registerJob(sj);
      }
      return true;
    } catch (error) {
      logger.warn({ msg: 'scheduler.job.toggle.failed', mod: 'toggleJob', profileId: this.currentProfileId, jobId, enabled, err: error });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async runJobNow(jobId: string, force?: boolean): Promise<SchedulerExecutionResult> {
    if (!this.currentProfileId) {
      return {
        success: false,
        error: 'Scheduler is not initialized for the current user.',
      };
    }

    const job = await this.getJob(jobId);
    if (!job) {
      return {
        success: false,
        error: `Schedule job not found: ${jobId}`,
      };
    }

    if (!force && !job.enabled) {
      return {
        success: false,
        error: 'Only enabled schedules can be triggered by the agent.',
      };
    }

    logger.info({ msg: 'scheduler.job.run-now.start', mod: 'runJobNow', profileId: this.currentProfileId, jobId: job.id, name: job.name, agentId: job.agentId, scheduleType: job.scheduleType });

    // step5 PR4：onReady 时机 = startRun 完成（runSession 已就绪），不再上游预生成 id。
    return await new Promise<SchedulerExecutionResult>((resolve) => {
      let resolved = false;

      void this.executeJob(job, 'manual', (readyPayload) => {
        if (resolved) return;
        resolved = true;
        resolve({
          success: true,
          chatSessionId: readyPayload.chatSessionId,
        });
      }).then((result) => {
        if (!result.success) {
          logger.warn({ msg: 'scheduler.job.run-now.dispatch-failed', mod: 'runJobNow', profileId: this.currentProfileId, jobId: job.id, name: job.name, err: result.error || 'Unknown error' });
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
    if (!this.currentProfileId) {
      return;
    }

    if (!Number.isFinite(suspendedAtMs) || !Number.isFinite(resumedAtMs) || resumedAtMs <= suspendedAtMs) {
      return;
    }

    try {
      const jobs = await this.listJobs();
      const recurringJobs = jobs.filter(
        (job) => job.enabled && job.scheduleType === 'cron' && !!job.cronExpression,
      );

      if (recurringJobs.length === 0) {
        return;
      }

      const schedulerTimeZone = getSchedulerTimeZone();
      let recoveredRuns = 0;

      logger.info({ msg: 'scheduler.resume-catchup.start', mod: 'handleSystemResume', profileId: this.currentProfileId, recurringJobs: recurringJobs.length, suspendedAt: new Date(suspendedAtMs).toISOString(), resumedAt: new Date(resumedAtMs).toISOString(), schedulerTimeZone });

      for (const job of recurringJobs) {
        const missedOccurrence = findMissedCronOccurrence(
          job.cronExpression || '',
          suspendedAtMs,
          resumedAtMs,
          schedulerTimeZone,
        );

        if (!missedOccurrence) {
          continue;
        }

        const catchUpDelayMs = resumedAtMs - missedOccurrence.getTime();
        if (!shouldCatchUpMissedOccurrence(missedOccurrence, resumedAtMs)) {
          logger.info({ msg: 'scheduler.resume-catchup.skip-stale', mod: 'handleSystemResume', profileId: this.currentProfileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), catchUpDelayMs, maxCatchUpDelayMs: MAX_RESUME_CATCH_UP_DELAY_MS });
          continue;
        }

        const lastRunAtMs = job.lastRunAt ? Date.parse(job.lastRunAt) : Number.NaN;
        if (Number.isFinite(lastRunAtMs) && lastRunAtMs >= missedOccurrence.getTime()) {
          logger.info({ msg: 'scheduler.resume-catchup.skip-started', mod: 'handleSystemResume', profileId: this.currentProfileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), lastRunAt: job.lastRunAt });
          continue;
        }

        logger.info({ msg: 'scheduler.resume-catchup.execute', mod: 'handleSystemResume', profileId: this.currentProfileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), catchUpDelayMs });

        const result = await this.executeJob(job, 'resume-catchup');
        if (result.success) {
          recoveredRuns += 1;
        }
      }

      logger.info({ msg: 'scheduler.resume-catchup.end', mod: 'handleSystemResume', profileId: this.currentProfileId, recurringJobs: recurringJobs.length, recoveredRuns });
    } catch (error) {
      logger.warn({ msg: 'scheduler.resume-catchup.failed', mod: 'handleSystemResume', profileId: this.currentProfileId, err: error });
    }
  }

  /**
   * Cold-start catchup：应用关机期间错过的 cron 触发，应用启动时补跑。
   *
   * 两类来源：
   *   1) pending 队列：上次启动检测到要补但还没跑（或跑失败）的；先消费。
   *   2) baseline 窗口：从上次 deactivate（clean-exit）或上次 activate（unclean-exit）
   *      到 startupAtMs，对每个 cron job 算 `findMissedCronOccurrence`。
   *
   * 补跑成功后 `dequeueCatchUp` 出队；失败则留在 pending 下次再试。
   * 去重：同一 `jobId::occurrenceAt` 不会被 pending + baseline 双重触发。
   */
  private async handleColdStartCatchUp(
    startupAtMs: number,
    jobs: SchedulerJob[],
    baseline: { isActive: boolean; lastActivatedAt?: string; lastDeactivatedAt?: string } | null,
    pendingCatchUps: Record<string, { occurrenceAt: string; recordedAt: string }>,
  ): Promise<void> {
    if (!this.currentProfile) {
      return;
    }

    const recurringJobs = jobs.filter(
      (job) => job.enabled && job.scheduleType === 'cron' && !!job.cronExpression,
    );

    if (recurringJobs.length === 0) {
      return;
    }

    const replayedPendingOccurrences = new Set<string>();
    let recoveredRuns = 0;

    // (1) 先消费 pending 队列
    for (const job of recurringJobs) {
      const pendingCatchUp = pendingCatchUps[job.id];
      if (!pendingCatchUp) {
        continue;
      }

      const pendingOccurrence = new Date(pendingCatchUp.occurrenceAt);
      if (!shouldCatchUpMissedOccurrence(pendingOccurrence, startupAtMs)) {
        await this.currentProfile.schedulerState.dequeueCatchUp(job.id);
        logger.info({ msg: 'scheduler.cold-start-catchup.drop-stale-pending', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, jobId: job.id, name: job.name, pendingOccurrenceAt: pendingCatchUp.occurrenceAt, recordedAt: pendingCatchUp.recordedAt });
        continue;
      }

      logger.info({ msg: 'scheduler.cold-start-catchup.replay-pending', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, jobId: job.id, name: job.name, pendingOccurrenceAt: pendingCatchUp.occurrenceAt });

      const result = await this.executeColdStartCatchUp(job, pendingCatchUp.occurrenceAt, true);
      if (result.success) {
        replayedPendingOccurrences.add(`${job.id}::${pendingCatchUp.occurrenceAt}`);
        recoveredRuns += 1;
      }
    }

    // (2) baseline 窗口算 missed occurrences
    const computedBaseline = getColdStartCatchUpBaseline(baseline);
    if (!computedBaseline) {
      logger.info({ msg: 'scheduler.cold-start-catchup.end-without-baseline', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, recurringJobs: recurringJobs.length, recoveredRuns });
      return;
    }

    const schedulerTimeZone = getSchedulerTimeZone();

    logger.info({ msg: 'scheduler.cold-start-catchup.start', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, recurringJobs: recurringJobs.length, windowStartAt: computedBaseline.windowStartAt, startupAt: new Date(startupAtMs).toISOString(), baselineSource: computedBaseline.source, schedulerTimeZone });

    for (const job of recurringJobs) {
      const missedOccurrence = findMissedCronOccurrence(
        job.cronExpression || '',
        computedBaseline.windowStartAt,
        startupAtMs,
        schedulerTimeZone,
      );

      if (!missedOccurrence) {
        continue;
      }

      const occurrenceKey = `${job.id}::${missedOccurrence.toISOString()}`;
      if (replayedPendingOccurrences.has(occurrenceKey)) {
        logger.info({ msg: 'scheduler.cold-start-catchup.skip-duplicate-pending', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, jobId: job.id, name: job.name, missedScheduledAt: missedOccurrence.toISOString() });
        continue;
      }

      const missedOccurrenceMs = missedOccurrence.getTime();
      const lastRunAtMs = job.lastRunAt ? Date.parse(job.lastRunAt) : Number.NaN;
      if (Number.isFinite(lastRunAtMs) && lastRunAtMs >= missedOccurrenceMs) {
        logger.info({ msg: 'scheduler.cold-start-catchup.skip-started', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), lastRunAt: job.lastRunAt });
        continue;
      }

      const catchUpDelayMs = startupAtMs - missedOccurrenceMs;
      if (!shouldCatchUpMissedOccurrence(missedOccurrence, startupAtMs)) {
        logger.info({ msg: 'scheduler.cold-start-catchup.skip-stale', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), catchUpDelayMs, maxCatchUpDelayMs: MAX_RESUME_CATCH_UP_DELAY_MS });
        continue;
      }

      logger.info({ msg: 'scheduler.cold-start-catchup.execute', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, jobId: job.id, name: job.name, cron: job.cronExpression, missedScheduledAt: missedOccurrence.toISOString(), catchUpDelayMs, baselineSource: computedBaseline.source });

      const result = await this.executeColdStartCatchUp(job, missedOccurrence.toISOString(), false);
      if (result.success) {
        recoveredRuns += 1;
      }
    }

    logger.info({ msg: 'scheduler.cold-start-catchup.end', mod: 'handleColdStartCatchUp', profileId: this.currentProfileId, recurringJobs: recurringJobs.length, recoveredRuns, baselineSource: computedBaseline.source });
  }

  /**
   * 单次 cold-start 补跑：
   *   - alreadyPending=true 表示从 pending 队列出来的，无需再 enqueue（避免覆写 recordedAt）。
   *   - alreadyPending=false 表示从 baseline 算出的新 missed occurrence，先 enqueue 再执行
   *     —— 这样补跑中途崩溃，下次启动 pending 队列还能再补。
   *   - 成功后 dequeueCatchUp 出队；失败留在队列里下次重试。
   */
  private async executeColdStartCatchUp(
    job: SchedulerJob,
    occurrenceAt: string,
    alreadyPending: boolean,
  ): Promise<SchedulerExecutionResult> {
    if (!this.currentProfile) {
      return {
        success: false,
        error: 'Scheduler is not initialized for the current user.',
      };
    }

    if (!alreadyPending) {
      await this.currentProfile.schedulerState.enqueueCatchUp(job.id, occurrenceAt, new Date().toISOString());
    }

    const result = await this.executeJob(job, 'cold-start-catchup');
    if (result.success) {
      await this.currentProfile.schedulerState.dequeueCatchUp(job.id);
    }

    return result;
  }

  private async recoverInterruptedScheduledSessions(): Promise<void> {
    // step5 PR4：扫所有 job 的磁盘 run，把 status='running' 的（上次进程崩在 turn 内）
    // 标 failed。listRunsOnDisk 只读 data.json，开销小。
    if (!this.currentProfile) {
      logger.info({ msg: 'scheduler.recover-interrupted.skip', mod: 'recoverInterruptedScheduledSessions', profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, reason: 'no-active-profile' });
      return;
    }
    let totalRecovered = 0;
    try {
      const flat = await this.currentProfile.listJobsFlat();
      const finishedAt = new Date().toISOString();
      const error = 'Interrupted by app shutdown';
      for (const { job } of flat) {
        const runs = await job.listRunsOnDisk();
        for (const run of runs) {
          if (run.runStatus !== 'running') continue;
          try {
            await job.finishRun(run.id, { status: 'failed', completedAt: finishedAt, error });
            totalRecovered += 1;
          } catch (err) {
            logger.warn({ msg: 'scheduler.recover-interrupted.finish-failed', mod: 'recoverInterruptedScheduledSessions', profileId: this.currentProfileId, jobId: job.id, runId: run.id, err });
          }
        }
      }
    } catch (err) {
      logger.warn({ msg: 'scheduler.recover-interrupted.failed', mod: 'recoverInterruptedScheduledSessions', profileId: this.currentProfileId, err });
    }
    logger.info({ msg: 'scheduler.recover-interrupted.summary', mod: 'recoverInterruptedScheduledSessions', profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, recovered: totalRecovered });
  }

  private async registerJob(job: SchedulerJob): Promise<void> {
    logger.info({ msg: 'scheduler.task.register.start', mod: 'registerJob', profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, jobId: job.id, name: job.name, scheduleType: job.scheduleType, cronExpression: job.cronExpression, runAt: job.runAt, enabled: job.enabled, status: job.status, lastRunAt: job.lastRunAt });

    logger.info({ msg: 'scheduler.task.register.dispatch', mod: 'registerJob', profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, jobId: job.id, scheduleType: job.scheduleType });

    if (job.scheduleType === 'once') {
      await this.registerOneTimeTask(job);
      return;
    }

    this.registerCronTask(job);
  }

  /** Register a recurring cron task */
  private registerCronTask(job: SchedulerJob): void {
    if (!job.cronExpression) {
      logger.warn({ msg: 'scheduler.cron.register.missing-cron-expression', mod: 'registerCronTask', jobId: job.id, name: job.name, schedulerGeneration: this.schedulerGeneration });
      return;
    }

    const previousMeta = this.taskRuntimeMeta.get(job.id);
    logger.info({ msg: 'scheduler.cron.register.before-replace-existing', mod: 'registerCronTask', profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, jobId: job.id, name: job.name, cronExpression: job.cronExpression, hadExistingTask: this.activeTasks.has(job.id), previousRuntimeMeta: previousMeta ? { ...previousMeta } : null });

    this.unregisterTask(job.id, 're-register-before-cron-register');

    const task = cron.schedule(job.cronExpression, async () => {
      const firedAt = new Date().toISOString();
      const activeTask = this.activeTasks.get(job.id);
      const runtimeMeta = this.taskRuntimeMeta.get(job.id);
      if (runtimeMeta) {
        this.taskRuntimeMeta.set(job.id, {
          ...runtimeMeta,
          lastTickArrivedAt: firedAt,
        });
      }

      logger.info({ msg: 'scheduler.cron.tick-arrived', mod: 'registerCronTask', jobId: job.id, name: job.name, profileId: this.currentProfileId, schedulerGeneration: runtimeMeta?.schedulerGeneration ?? this.schedulerGeneration, taskSequence: runtimeMeta?.taskSequence, firedAt, activeTaskExists: !!activeTask, activeTaskCount: this.activeTasks.size, pid: process.pid });

      logger.info({ msg: 'scheduler.cron.tick-dispatch-executeJob', mod: 'registerCronTask', jobId: job.id, profileId: this.currentProfileId, schedulerGeneration: runtimeMeta?.schedulerGeneration ?? this.schedulerGeneration, taskSequence: runtimeMeta?.taskSequence, firedAt });
      await this.executeJob(job, 'scheduled');
    });

    this.activeTasks.set(job.id, { kind: 'cron', task });
    const runtimeMeta = this.createTaskRuntimeMeta(job, 'cron');
    runtimeMeta.lastCronWatchdogCheckedAt = runtimeMeta.registeredAt;
    this.taskRuntimeMeta.set(job.id, runtimeMeta);

    logger.info({ msg: 'scheduler.cron.registered', mod: 'registerCronTask', jobId: job.id, name: job.name, profileId: this.currentProfileId, cronExpression: job.cronExpression, schedulerGeneration: runtimeMeta.schedulerGeneration, taskSequence: runtimeMeta.taskSequence, registeredAt: runtimeMeta.registeredAt, activeTaskCountAfter: this.activeTasks.size, activeTaskKeysAfter: Array.from(this.activeTasks.keys()) });
  }

  /** Register a one-time scheduled task */
  private async registerOneTimeTask(job: SchedulerJob): Promise<void> {
    if (!job.runAt) {
      logger.warn({ msg: 'scheduler.once.register.missing-runAt', mod: 'registerOneTimeTask', jobId: job.id, name: job.name, schedulerGeneration: this.schedulerGeneration });
      return;
    }

    const runAtMs = Date.parse(job.runAt);
    if (Number.isNaN(runAtMs)) {
      logger.warn({ msg: 'scheduler.once.register.invalid-runAt', mod: 'registerOneTimeTask', jobId: job.id, name: job.name, runAt: job.runAt, schedulerGeneration: this.schedulerGeneration });
      return;
    }

    const delayMs = runAtMs - Date.now();
    if (delayMs <= 0) {
      await this.markOneTimeJobExpired(job.id);
      return;
    }

    const previousMeta = this.taskRuntimeMeta.get(job.id);
    logger.info({ msg: 'scheduler.once.register.before-replace-existing', mod: 'registerOneTimeTask', profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, jobId: job.id, name: job.name, runAt: job.runAt, hadExistingTask: this.activeTasks.has(job.id), previousRuntimeMeta: previousMeta ? { ...previousMeta } : null });

    this.unregisterTask(job.id, 're-register-before-once-register');

    const scheduleTimeout = (remainingMs: number) => {
      const nextDelayMs = Math.min(remainingMs, MAX_TIMEOUT_MS);
      const timer = setTimeout(async () => {
        const activeTask = this.activeTasks.get(job.id);
        if (!activeTask || activeTask.kind !== 'timeout') {
          return;
        }

        if (remainingMs > MAX_TIMEOUT_MS) {
          await this.registerOneTimeTask(job);
          return;
        }

        this.unregisterTask(job.id, 'once-job-fired');
        await this.executeJob(job, 'scheduled');
      }, nextDelayMs);

      this.activeTasks.set(job.id, { kind: 'timeout', timer });
    };

    scheduleTimeout(delayMs);
    const runtimeMeta = this.createTaskRuntimeMeta(job, 'timeout');
    this.taskRuntimeMeta.set(job.id, runtimeMeta);

    logger.info({ msg: 'scheduler.once.registered', mod: 'registerOneTimeTask', jobId: job.id, name: job.name, runAt: job.runAt, delayMs, profileId: this.currentProfileId, schedulerGeneration: runtimeMeta.schedulerGeneration, taskSequence: runtimeMeta.taskSequence });
  }

  /** Unregister a single task */
  private unregisterTask(jobId: string, reason: SchedulerTaskUnregisterReason): void {
    const activeTask = this.activeTasks.get(jobId);
    if (!activeTask) {
      logger.info({ msg: 'scheduler.task.unregister.skip-missing', mod: 'unregisterTask', jobId, reason, profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration });
      return;
    }

    const unregisteredAt = new Date().toISOString();
    const previousRuntimeMeta = this.taskRuntimeMeta.get(jobId);
    logger.info({ msg: 'scheduler.task.unregister.start', mod: 'unregisterTask', jobId, reason, profileId: this.currentProfileId, schedulerGeneration: previousRuntimeMeta?.schedulerGeneration ?? this.schedulerGeneration, previousRuntimeMeta: previousRuntimeMeta ? { ...previousRuntimeMeta } : null });

    if (activeTask.kind === 'cron') {
      activeTask.task.stop();
    } else {
      clearTimeout(activeTask.timer);
    }

    this.activeTasks.delete(jobId);

    if (previousRuntimeMeta) {
      this.taskRuntimeMeta.set(jobId, {
        ...previousRuntimeMeta,
        unregisteredAt,
        lastUnregisterReason: reason,
      });
    }

    logger.info({ msg: 'scheduler.task.unregister.end', mod: 'unregisterTask', jobId, reason, profileId: this.currentProfileId, schedulerGeneration: previousRuntimeMeta?.schedulerGeneration ?? this.schedulerGeneration, activeTaskCountAfter: this.activeTasks.size });
  }

  private clearActiveTasks(reason: SchedulerTaskUnregisterReason): void {
    const jobIds = Array.from(this.activeTasks.keys());
    logger.info({ msg: 'scheduler.tasks.clear.start', mod: 'clearActiveTasks', profileId: this.currentProfileId, reason, count: jobIds.length, jobIds, schedulerGeneration: this.schedulerGeneration, taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(jobIds) });

    for (const [jobId] of this.activeTasks) {
      this.unregisterTask(jobId, reason);
    }

    logger.info({ msg: 'scheduler.tasks.clear.end', mod: 'clearActiveTasks', profileId: this.currentProfileId, reason, count: this.activeTasks.size, schedulerGeneration: this.schedulerGeneration });
  }

  private async markOneTimeJobExpired(jobId: string): Promise<void> {
    if (!this.currentProfileId) return;
    const profile = this.requireProfile();

    this.unregisterTask(jobId, 'once-job-expired');
    // 新模型无独立 expired 状态——语义等价于"禁用 one-time job"。
    const hit = await profile.findJob(jobId);
    if (hit) {
      hit.job.applyUpdate({ enabled: false });
      await hit.job.persist();
    }
    logger.info({ msg: 'scheduler.once.expired-before-execution', mod: 'markOneTimeJobExpired', jobId });
  }

  /**
   * Execute a job: 走 persist `ScheduleJob.startRun` 创建一次 run session，
   * 再 `pi.JobRun.run` 静默跑完，结束时 `finishRun` 同步 runState。
   * notifyOnCompletion 默认 true：跑完发系统通知。
   */
  private async executeJob(
    job: SchedulerJob,
    triggerSource: 'scheduled' | 'manual' | 'resume-catchup' | 'cold-start-catchup' | 'watchdog-catchup',
    onReady?: (payload: { chatSessionId: string }) => void,
  ): Promise<SchedulerExecutionResult> {
    const startedAt = new Date().toISOString();
    const runtimeMeta = this.taskRuntimeMeta.get(job.id);
    if (runtimeMeta) {
      this.taskRuntimeMeta.set(job.id, {
        ...runtimeMeta,
        lastExecuteStartAt: startedAt,
      });
    }

    logger.info({ msg: 'scheduler.execute.start', mod: 'executeJob', jobId: job.id, name: job.name, agentId: job.agentId, scheduleType: job.scheduleType, triggerSource, profileId: this.currentProfileId, schedulerGeneration: runtimeMeta?.schedulerGeneration ?? this.schedulerGeneration, taskSequence: runtimeMeta?.taskSequence });

    const markFinish = (outcome: 'success' | 'failed', endedAt: string): void => {
      const meta = this.taskRuntimeMeta.get(job.id);
      if (meta) {
        this.taskRuntimeMeta.set(job.id, {
          ...meta,
          lastExecuteEndAt: endedAt,
          lastExecuteOutcome: outcome,
        });
      }
    };

    if (!this.currentProfile) {
      const error = 'Scheduler is not initialized for the current user.';
      markFinish('failed', new Date().toISOString());
      logger.error({ msg: 'scheduler.execute.end', mod: 'executeJob', jobId: job.id, triggerSource, err: error, success: false });
      return { success: false, error };
    }

    let agent;
    let persistJob;
    try {
      agent = await this.currentProfile.getAgent(job.agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${job.agentId}`);
      }
      persistJob = await agent.getJob(job.id);
      if (!persistJob) {
        throw new Error(`Schedule job not found in persist: ${job.id}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      markFinish('failed', new Date().toISOString());
      logger.error({ msg: 'scheduler.execute.end', mod: 'executeJob', jobId: job.id, triggerSource, err: msg, success: false });
      return { success: false, error: msg };
    }

    // 1) 启动 run session（writes data.json + 更新 runState=running + emit）
    let runSession;
    try {
      runSession = await persistJob.startRun({ startedAt });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      markFinish('failed', new Date().toISOString());
      logger.error({ msg: 'scheduler.execute.start-run-failed', mod: 'executeJob', jobId: job.id, triggerSource, err: msg });
      return { success: false, error: msg };
    }

    // onReady 触发时机：run session 已落盘可访问（旧 chat engine 是预生成 id 立即回调，
    // 新模型把 onReady 推迟到 startRun 完成 —— UI 跳转契约一致，仍 < 100ms 内）。
    onReady?.({ chatSessionId: runSession.id });

    // 2) 静默 turn loop
    const userMsg = createUserMessage({ content: job.message });
    const piJobRun = new JobRun(runSession.id, this.currentProfile.id, job.agentId, runSession);

    let messageCount = 0;
    let runError: string | null = null;
    try {
      const r = await piJobRun.run(userMsg);
      messageCount = r.messageCount;
    } catch (error) {
      runError = error instanceof Error ? (error.message || 'unknown error') : String(error);
    }

    // 3) finishRun 同步 runState + (可能) 发系统通知
    const completedAt = new Date().toISOString();
    try {
      if (runError == null) {
        await persistJob.finishRun(runSession.id, { status: 'completed', completedAt });
      } else {
        await persistJob.finishRun(runSession.id, { status: 'failed', completedAt, error: runError });
      }
    } catch (err) {
      logger.warn({ msg: 'scheduler.execute.finish-run-failed', mod: 'executeJob', jobId: job.id, runId: runSession.id, err });
    }

    if (job.notifyOnCompletion) {
      showSessionCompletionNotification({
        agentId: job.agentId,
        jobId: job.id,
        sessionId: runSession.id,
        sessionTitle: runSession.title,
        outcome: runError == null ? 'completed' : 'failed',
      });
    }

    if (job.scheduleType === 'once') {
      this.unregisterTask(job.id, runError == null ? 'once-job-completed' : 'once-job-failed');
    }

    if (runError == null) {
      markFinish('success', completedAt);
      logger.info({ msg: 'scheduler.execute.end', mod: 'executeJob', jobId: job.id, name: job.name, triggerSource, chatSessionId: runSession.id, messagesCount: messageCount, success: true });
      return { success: true, chatSessionId: runSession.id, messagesCount: messageCount };
    }

    markFinish('failed', completedAt);
    logger.error({ msg: 'scheduler.execute.end', mod: 'executeJob', jobId: job.id, name: job.name, triggerSource, chatSessionId: runSession.id, err: runError, success: false });
    return { success: false, chatSessionId: runSession.id, error: runError };
  }

  /** Dispose all runtime tasks (called on app exit) */
  async dispose(reason: SchedulerDisposeReason = 'unknown'): Promise<void> {
    logger.info({ msg: 'scheduler.dispose.start', mod: 'dispose', reason, profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, activeTaskCountBefore: this.activeTasks.size, activeJobIdsBefore: Array.from(this.activeTasks.keys()), taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(Array.from(this.activeTasks.keys())) });

    // step5 PR5b：先写 markDeactivated（clean-exit baseline），再 stopHeartbeat / clearActiveTasks。
    // 顺序：写盘 → 停止任务 → 清缓存；若写盘失败 logger.warn 不阻断。
    if (this.currentProfile) {
      try {
        await this.currentProfile.schedulerState.markDeactivated(new Date().toISOString());
      } catch (err) {
        logger.warn({ msg: 'scheduler.dispose.mark-deactivated-failed', mod: 'dispose', profileId: this.currentProfileId, err });
      }
    }

    this.stopHeartbeat();
    this.clearActiveTasks(reason === 'unknown' ? 'dispose' : reason);
    this.currentProfile = null;
    this.currentProfileId = null;
    logger.info({ msg: 'scheduler.dispose.end', mod: 'dispose', reason, schedulerGeneration: this.schedulerGeneration, activeTaskCountAfter: this.activeTasks.size });
  }

  private createTaskRuntimeMeta(job: SchedulerJob, taskKind: ActiveTask['kind']): SchedulerTaskRuntimeMeta {
    this.taskSequence += 1;
    return {
      jobId: job.id,
      profileId: this.currentProfileId,
      schedulerGeneration: this.schedulerGeneration,
      taskSequence: this.taskSequence,
      taskKind,
      registeredAt: new Date().toISOString(),
      cronExpression: job.cronExpression,
      runAt: job.runAt,
    };
  }

  private getTaskRuntimeMetaSnapshot(jobIds: string[]): SchedulerTaskRuntimeMeta[] {
    return jobIds
      .map((jobId) => this.taskRuntimeMeta.get(jobId))
      .filter((meta): meta is SchedulerTaskRuntimeMeta => !!meta)
      .map((meta) => ({ ...meta }));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.activeTasks.size === 0) {
        return;
      }

      logger.info({ msg: 'scheduler.heartbeat', mod: 'heartbeat', profileId: this.currentProfileId, schedulerGeneration: this.schedulerGeneration, activeTaskCount: this.activeTasks.size, activeTaskJobIds: Array.from(this.activeTasks.keys()) });

      const cronJobIds = Array.from(this.activeTasks.entries())
        .filter(([, task]) => task.kind === 'cron')
        .map(([jobId]) => jobId);
      void runCronWatchdog({
        profileId: this.currentProfileId,
        heartbeatIntervalMs: SchedulerManager.HEARTBEAT_INTERVAL_MS,
        cronJobIds,
        getRuntimeMeta: (jobId) => this.taskRuntimeMeta.get(jobId),
        setRuntimeMeta: (jobId, meta) => {
          const current = this.taskRuntimeMeta.get(jobId);
          if (current) {
            this.taskRuntimeMeta.set(jobId, {
              ...current,
              ...meta,
            });
          }
        },
        getJob: (jobId) => this.getJob(jobId),
        executeJob: async (job) => {
          await this.executeJob(job, 'watchdog-catchup');
        },
      });
    }, SchedulerManager.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export const schedulerManager = SchedulerManager.getInstance();
