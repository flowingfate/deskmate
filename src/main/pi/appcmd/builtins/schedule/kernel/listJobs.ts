/**
 * Schedule "list" 内核 —— 列出 scheduler 已登记的全部或某个 agent 的 job。
 *
 * 被 `appcmd/builtins/schedule/list.ts` 调用。renderer 不消费(走
 * `SchedulerIPC.listJobs`)。
 *
 * `signal` 形状对齐;`schedulerManager.listJobs` 本质是本地 persist 读,
 * 没有挂中止的实际意义。
 */

import { schedulerManager } from '@main/lib/scheduler/SchedulerManager';

import { jobToView, type JobView } from './types';

export interface ListJobsArgs {
  /** 可选:按 agent id 过滤;不填返回全部。 */
  agent_id?: string;
}

export type ListJobsResult =
  | { success: true; schedules: JobView[] }
  | { success: false; message: string };

export async function listJobsInternal(
  args: ListJobsArgs,
  _opts?: { signal?: AbortSignal },
): Promise<ListJobsResult> {
  try {
    const jobs = await schedulerManager.listJobs(args.agent_id);
    return { success: true, schedules: jobs.map(jobToView) };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list schedules: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
