/**
 * Schedule "run" 内核 —— 立即触发一条已登记 job(走与 scheduler 自动触发
 * 完全相同的执行链路)。一次性 job 被手动触发后会被消费、标记 completed
 * 或 failed。
 *
 * 被 `appcmd/builtins/app/schedule/run.ts` 调用。renderer 不消费(走
 * `SchedulerIPC.runJobNow`)。
 *
 * 注:老 `RunScheduleToolResult` 声明了 `messages_count`,但 `schedulerManager
 * .runJobNow` **从不**返回该字段 —— 是死字段,这里**不**搬。LLM 真需要
 * 已执行轮次走 `schedule list` 看 `last_run_at`。
 */

import { schedulerManager } from '@main/lib/scheduler/SchedulerManager';

export interface RunJobNowArgs {
  job_id: string;
}

export type RunJobNowResult =
  | { success: true; message: string; chat_session_id?: string }
  | { success: false; message: string };

export async function runJobNowInternal(
  args: RunJobNowArgs,
  _opts?: { signal?: AbortSignal },
): Promise<RunJobNowResult> {
  try {
    const result = await schedulerManager.runJobNow(args.job_id);
    if (!result.success) {
      return {
        success: false,
        message: result.error || `Failed to run schedule "${args.job_id}".`,
      };
    }
    return {
      success: true,
      message: `Schedule "${args.job_id}" triggered.`,
      chat_session_id: result.chatSessionId,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
