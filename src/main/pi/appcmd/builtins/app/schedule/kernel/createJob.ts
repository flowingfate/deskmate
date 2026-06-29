/**
 * Schedule "create" 内核 —— 登记一条 cron / one-time job。
 *
 * 被 `appcmd/builtins/app/schedule/create.ts` 调用。renderer 不消费(renderer
 * 走 `SchedulerIPC.createJob` IPC 直通 `schedulerManager.createJob`)。
 *
 * 业务约束:
 *   - `cron_expression` / `run_at` 二选一,**互斥**且**必须有其一**。
 *   - `agent_id` 缺省走 caller 给的 `fallbackAgentId`(通常是 `ctx.agentId`)。
 *   - 失败统一通过 `{ success: false, message }` envelope 回流,**不抛错**。
 *
 * `signal` 仅做契约形状对齐 —— `schedulerManager.createJob` 内部是单次写,
 * 没有可中止的长任务。
 */

import { schedulerManager } from '@main/lib/scheduler/SchedulerManager';

export interface CreateJobArgs {
  /** Human-readable name. */
  name: string;
  /** 自然语言描述(写盘到 persist;LLM 调用动机的记录)。 */
  description: string;
  /** 触发时发给 agent 的首消息 prompt。 */
  message: string;
  /** Cron 表达式(5/6 字段)。与 run_at 二选一。 */
  cron_expression?: string;
  /** ISO 8601 timestamp。与 cron_expression 二选一。 */
  run_at?: string;
  /** 目标 agent;缺省走 caller fallback。 */
  agent_id?: string;
}

export type CreateJobResult =
  | { success: true; job_id: string; schedule_type: 'cron' | 'once'; message: string }
  | { success: false; message: string };

export async function createJobInternal(
  args: CreateJobArgs,
  fallbackAgentId: string,
  _opts?: { signal?: AbortSignal },
): Promise<CreateJobResult> {
  try {
    const agentId = args.agent_id || fallbackAgentId;
    if (!agentId) {
      return { success: false, message: 'agent_id is required and no fallback agent is available.' };
    }

    const hasCron = typeof args.cron_expression === 'string' && args.cron_expression.trim().length > 0;
    const hasAt = typeof args.run_at === 'string' && args.run_at.trim().length > 0;
    if (hasCron === hasAt) {
      return {
        success: false,
        message: 'Provide exactly one of --cron or --at (recurring vs one-time).',
      };
    }

    const scheduleType: 'cron' | 'once' = hasAt ? 'once' : 'cron';

    let jobId: string;
    try {
      jobId = await schedulerManager.createJob({
        description: args.description,
        name: args.name,
        scheduleType,
        cronExpression: hasCron ? args.cron_expression?.trim() : undefined,
        runAt: hasAt ? args.run_at?.trim() : undefined,
        enabled: true,
        agentId,
        message: args.message,
        status: 'pending',
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message:
          scheduleType === 'once'
            ? `Failed to create one-time schedule: ${detail}`
            : `Failed to create recurring schedule: ${detail}`,
      };
    }

    return {
      success: true,
      job_id: jobId,
      schedule_type: scheduleType,
      message:
        scheduleType === 'once'
          ? `One-time schedule "${args.name}" created. Runs at ${args.run_at}.`
          : `Recurring schedule "${args.name}" created. Cron: ${args.cron_expression}.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
