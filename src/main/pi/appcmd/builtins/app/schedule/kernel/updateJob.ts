/**
 * Schedule "update" 内核 —— 更新一条 job 的配置。
 * schedule 是 discriminated union：切换类型时必须同时给出该类型的完整触发值。
 */
import type { Profile } from '@main/profile';
import type { SchedulerJobUpdate } from '@shared/ipc/scheduler';

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

export async function updateJobInternal(
  args: UpdateJobArgs,
  opts: { profile: Profile; signal?: AbortSignal },
): Promise<UpdateJobResult> {
  try {
    const hasConfigUpdate =
      args.name !== undefined ||
      args.description !== undefined ||
      args.message !== undefined ||
      args.enabled !== undefined;
    const hasCron = args.cron_expression !== undefined;
    const hasRunAt = args.run_at !== undefined;

    if (!hasConfigUpdate && !hasCron && !hasRunAt && args.schedule_type === undefined) {
      return {
        success: false,
        message:
          'No fields to update. Provide at least one of: --name, --description, --schedule-type, --cron, --at, --message, --enabled.',
      };
    }
    if (hasCron && hasRunAt) {
      return { success: false, message: 'Provide either --cron or --at, not both.' };
    }
    if (args.schedule_type === 'cron' && !hasCron) {
      return { success: false, message: '--schedule-type cron requires --cron.' };
    }
    if (args.schedule_type === 'once' && !hasRunAt) {
      return { success: false, message: '--schedule-type once requires --at.' };
    }
    if (args.schedule_type === 'once' && hasCron) {
      return { success: false, message: '--schedule-type once conflicts with --cron.' };
    }
    if (args.schedule_type === 'cron' && hasRunAt) {
      return { success: false, message: '--schedule-type cron conflicts with --at.' };
    }

    const common = {
      name: args.name,
      description: args.description,
      message: args.message,
      enabled: args.enabled,
    };
    let updates: SchedulerJobUpdate;
    if (args.cron_expression !== undefined) {
      updates = { ...common, scheduleType: 'cron', cronExpression: args.cron_expression };
    } else if (args.run_at !== undefined) {
      updates = { ...common, scheduleType: 'once', runAt: args.run_at };
    } else {
      updates = common;
    }

    const schedulerManager = opts.profile.scheduler;
    const success = await schedulerManager.updateJob(args.job_id, updates);
    if (!success) {
      return {
        success: false,
        message: `Failed to update schedule "${args.job_id}". The job may not exist, or the schedule configuration may be invalid.`,
      };
    }

    const jobs = await schedulerManager.listJobs();
    const updated = jobs.find((job) => job.id === args.job_id);
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
