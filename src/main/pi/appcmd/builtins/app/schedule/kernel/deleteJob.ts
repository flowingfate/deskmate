/**
 * Schedule "remove" 内核 —— 物理删除一条 schedule job。
 *
 * 被 `appcmd/builtins/app/schedule/remove.ts` 调用。**破坏性 op**:
 * subcommand 层强制 `--yes` 守卫(参考 `mcp remove` 范式);本内核不重复
 * 校验,假定 caller 已经做了 confirmation。
 *
 * 业务规则:
 *   - `schedulerManager.deleteJob` 已存在(被 `SchedulerIPC.deleteJob` 用),
 *     返回 boolean:true=删了,false=job 不存在或失败。
 *   - 找不到 job 时回 `{ success: false }` —— 与 mcp remove 同形态(让 LLM
 *     看到具体 not found 信号,而非静默 success)。
 *
 * `signal` 仅形状对齐。
 */

import { schedulerManager } from '@main/lib/scheduler';

export interface DeleteJobArgs {
  job_id: string;
}

export type DeleteJobResult =
  | { success: true; message: string }
  | { success: false; message: string };

export async function deleteJobInternal(
  args: DeleteJobArgs,
  _opts?: { signal?: AbortSignal },
): Promise<DeleteJobResult> {
  try {
    const ok = await schedulerManager.deleteJob(args.job_id);
    if (!ok) {
      return {
        success: false,
        message: `Schedule "${args.job_id}" not found.`,
      };
    }
    return {
      success: true,
      message: `Removed schedule "${args.job_id}".`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to remove schedule: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
