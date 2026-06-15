/**
 * Schedule "update" 内核 —— 更新一条 job 的字段。
 *
 * 被 `appcmd/builtins/schedule/update.ts` 调用。
 *
 * 业务规则(原样从老 `updateScheduleInternal` 搬过来,跑了无数生产 schedule):
 *   - 改 schedule_type 但没给新 cron / run_at → 清掉对应字段,让 manager
 *     用现有的另一种继续算。
 *   - 显式给 cron_expression / run_at → 强制对齐 scheduleType,并把
 *     status / executedAt / lastRunAt 复位(让被 completed/expired 的 job
 *     重新 pending,否则下次触发不会发生)。
 *   - 没字段可更新 → success=false + 提示。
 *
 * `signal` 形状对齐;`schedulerManager.updateJob` 内部是单次写。
 */

import { schedulerManager } from '@main/lib/scheduler/SchedulerManager';
import type { SchedulerJob } from '@main/lib/scheduler/types';

import { jobToView, type JobView } from './types';

export interface UpdateJobArgs {
  job_id: string;
  name?: string;
  description?: string;
  schedule_type?: 'cron' | 'once';
  cron_expression?: string;
  run_at?: string;
  message?: string;
  enabled?: boolean;
}

export type UpdateJobResult =
  | { success: true; message: string; job?: JobView }
  | { success: false; message: string };

type SchedulerJobUpdates = Partial<
  Pick<
    SchedulerJob,
    | 'name'
    | 'description'
    | 'scheduleType'
    | 'cronExpression'
    | 'runAt'
    | 'message'
    | 'enabled'
    | 'status'
    | 'executedAt'
    | 'lastRunAt'
  >
>;

export async function updateJobInternal(
  args: UpdateJobArgs,
  _opts?: { signal?: AbortSignal },
): Promise<UpdateJobResult> {
  try {
    const updates: SchedulerJobUpdates = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.schedule_type !== undefined) updates.scheduleType = args.schedule_type;
    if (args.cron_expression !== undefined) updates.cronExpression = args.cron_expression;
    if (args.run_at !== undefined) updates.runAt = args.run_at;
    if (args.message !== undefined) updates.message = args.message;
    if (args.enabled !== undefined) updates.enabled = args.enabled;

    if (Object.keys(updates).length === 0) {
      return {
        success: false,
        message:
          'No fields to update. Provide at least one of: --name, --description, --schedule-type, --cron, --at, --message, --enabled.',
      };
    }

    // 切换 scheduleType 但没给对应新值 → 清掉另一种(让 manager 用残留计算下次触发)。
    if (args.schedule_type === 'cron' && args.cron_expression === undefined) {
      updates.runAt = undefined;
    }
    if (args.schedule_type === 'once' && args.run_at === undefined) {
      updates.cronExpression = undefined;
    }
    // 显式给 cron / run_at → 强制对齐 type + 复位执行态(把 expired/completed 拉回 pending)。
    if (args.cron_expression !== undefined) {
      updates.scheduleType = 'cron';
      updates.runAt = undefined;
      updates.status = 'pending';
      updates.executedAt = undefined;
      updates.lastRunAt = undefined;
    }
    if (args.run_at !== undefined) {
      updates.scheduleType = 'once';
      updates.cronExpression = undefined;
      updates.status = 'pending';
      updates.executedAt = undefined;
      updates.lastRunAt = undefined;
    }

    const success = await schedulerManager.updateJob(args.job_id, updates);

    if (!success) {
      return {
        success: false,
        message: `Failed to update schedule "${args.job_id}". The job may not exist, or the schedule configuration may be invalid.`,
      };
    }

    // 回读最新 job 投回 LLM,方便链式调用。
    const jobs = await schedulerManager.listJobs();
    const updated = jobs.find((j) => j.id === args.job_id);
    return {
      success: true,
      message: 'Schedule updated.',
      job: updated ? jobToView(updated) : undefined,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
