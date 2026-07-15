import * as cron from 'node-cron';
import type { JobRunState, ScheduleJobFile } from '@shared/persist/types';
import type {
  SchedulerJob,
  SchedulerJobCreateInput,
  SchedulerJobUpdate,
} from '@shared/ipc/scheduler';
import type { ScheduleJobInput } from '@main/persist/agent';
import type { ScheduleJobUpdate as PersistScheduleJobUpdate } from '@main/persist/schedule';

type SchedulerSchedule =
  | { scheduleType: 'cron'; cronExpression: string }
  | { scheduleType: 'once'; runAt: string };

function assertValidSchedulerSchedule(schedule: SchedulerSchedule): void {
  if (schedule.scheduleType === 'cron') {
    if (!cron.validate(schedule.cronExpression)) {
      throw new Error(`Invalid cron expression: ${schedule.cronExpression}`);
    }
    return;
  }

  if (Number.isNaN(Date.parse(schedule.runAt))) {
    throw new Error(`Invalid one-time schedule time: ${schedule.runAt}`);
  }
}


/**
 * 把持久化 schedule + 最近运行状态投影为跨层使用的任务视图。
 * 任务配置与运行状态仍各自归 persist 所有；视图只公开 catch-up 和 UI 所需的最近开始时间。
 */
export function toSchedulerJob(file: ScheduleJobFile, runState: JobRunState): SchedulerJob {
  const base = {
    id: file.id,
    agentId: file.agentId,
    name: file.name,
    description: file.description ?? '',
    enabled: file.enabled,
    message: file.message,
    lastStartedAt: 'startedAt' in runState ? runState.startedAt : undefined,
    notifyOnCompletion: file.notifyOnCompletion ?? true,
  };

  if (file.scheduleType === 'cron') {
    return { ...base, scheduleType: 'cron', cronExpression: file.cron };
  }
  return { ...base, scheduleType: 'once', runAt: file.runAt };
}

/** 把 IPC create payload 投射成 persist `Agent.createJob` 的输入。 */
export function toScheduleJobInput(input: SchedulerJobCreateInput): ScheduleJobInput {
  assertValidSchedulerSchedule(input);
  const version = 1;
  const common = {
    version,
    name: input.name,
    description: input.description || undefined,
    message: input.message,
    enabled: input.enabled,
    notifyOnCompletion: input.notifyOnCompletion,
  };

  if (input.scheduleType === 'cron') {
    if (!input.cronExpression) {
      throw new Error('toScheduleJobInput: cronExpression required for cron job');
    }
    return { ...common, scheduleType: 'cron', cron: input.cronExpression };
  }

  if (!input.runAt) {
    throw new Error('toScheduleJobInput: runAt required for once job');
  }
  return { ...common, scheduleType: 'once', runAt: input.runAt };
}

/** 把 IPC update payload 投射成 persist 的部分更新；schedule 切换必须完整替换 union 分支。 */
export function toPersistScheduleJobUpdate(
  partial: SchedulerJobUpdate,
): PersistScheduleJobUpdate {
  const out: PersistScheduleJobUpdate = {};
  if (partial.name !== undefined) out.name = partial.name;
  if (partial.description !== undefined) out.description = partial.description;
  if (partial.message !== undefined) out.message = partial.message;
  if (partial.enabled !== undefined) out.enabled = partial.enabled;
  if (partial.notifyOnCompletion !== undefined) out.notifyOnCompletion = partial.notifyOnCompletion;

  if (partial.scheduleType === 'cron') {
    assertValidSchedulerSchedule(partial);
    out.schedule = { kind: 'cron', cron: partial.cronExpression };
  } else if (partial.scheduleType === 'once') {
    assertValidSchedulerSchedule(partial);
    out.schedule = { kind: 'once', runAt: partial.runAt };
  }

  return out;
}
