/**
 * jobAdapter — 老 SchedulerJob ↔ persist ScheduleJobFile 双向转换。
 *
 * - 对外（IPC / renderer / mcpRuntime tools）继续吃旧 `SchedulerJob` 扁平形状。
 * - 对内（persist 层）用 union by `scheduleType`（`cron` | `once`）+ 独立 `JobRunState`。
 *
 * 状态机映射（`runState.status` ↔ 旧 `SchedulerJob.status` 双向投影）：
 *   runState.status='pending'   → 旧 status='pending'，无 lastRunAt
 *   runState.status='running'   → 旧 status='pending'，lastRunAt=startedAt（旧 UI 用 startedAt 非空判 "正在跑"）
 *   runState.status='completed' → 旧 status='completed'，lastRunAt/lastFinishedAt 填全
 *   runState.status='failed'    → 旧 status='failed'，同上（旧 IPC 没有 error 字段）
 *
 * "expired"：旧 one-time job 过期是独立 status；新模型用 `enabled=false` 表达。
 * adapter 在 `enabled=false && scheduleType='once' && runState.status='pending'` 时反推为 'expired'，
 * 保持 renderer 旧契约。
 */

import type { JobRunState, ScheduleJobFile } from '@shared/persist/types';
import type { ScheduleJobInput } from '@main/persist/agent';
import type { ScheduleJobUpdate as PersistScheduleJobUpdate } from '@main/persist/schedule';
import { SchedulerJob, ScheduleJobCreateInput } from './types';

export function toSchedulerJob(file: ScheduleJobFile, runState: JobRunState): SchedulerJob {
  const lastRunAt = 'startedAt' in runState ? runState.startedAt : undefined;
  const lastFinishedAt = 'finishedAt' in runState ? runState.finishedAt : undefined;

  let status: SchedulerJob['status'];
  if (runState.status === 'completed') status = 'completed';
  else if (runState.status === 'failed') status = 'failed';
  else status = 'pending'; // pending + running 都收敛到旧 pending

  // 旧 expired 反推：once + 已禁用 + 从未真正跑过完成/失败 → expired
  if (
    file.enabled === false
    && file.scheduleType === 'once'
    && runState.status === 'pending'
  ) {
    status = 'expired';
  }

  return {
    id: file.id,
    agentId: file.agentId,
    name: file.name,
    description: file.description ?? '',
    scheduleType: file.scheduleType,
    cronExpression: file.scheduleType === 'cron' ? file.cron : undefined,
    runAt: file.scheduleType === 'once' ? file.runAt : undefined,
    enabled: file.enabled,
    message: file.message,
    status,
    lastRunAt,
    lastFinishedAt,
    executedAt: undefined, // 旧字段，renderer 无消费，永不外露
    notifyOnCompletion: file.notifyOnCompletion ?? true,
  };
}

/**
 * 把老 createJob 入参投射成 persist `Agent.createJob` 的 ScheduleJobInput。
 * - 丢弃 `id`（persist 内生 ULID）、`status` / `lastRunAt` / `lastFinishedAt` / `executedAt`（runState 自带）。
 * - 根据 `scheduleType` 走 discriminated union 分支。
 */
export function toScheduleJobInput(input: ScheduleJobCreateInput): ScheduleJobInput {
  // agentId 由 Agent.createJob 自填（this.id），input 上携带反而被覆盖；故不在 common 里。
  const common = {
    version: 1 as const,
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

/**
 * 把老 `SchedulerJob` 部分字段 update payload 投射成 persist `ScheduleJob.applyUpdate` 的入参。
 *
 * 仅 name / description / message / enabled / notifyOnCompletion / schedule 透传；
 * 老的 `status` / `lastRunAt` / `executedAt` 字段属于 runState 状态机，不允许外部直接 mutate，
 * 一律忽略（updateScheduleTool 旧调用方传过来的 status='pending' 等会被丢掉——新模型中
 * runState 由 startRun/finishRun 自管，外部强 reset 没有合理语义）。
 *
 * scheduleType 切换：调用方必须同时把对应 cron / runAt 字段也带齐，缺则抛错（与
 * persist `ScheduleJobConfig.applyUpdate` 行为一致）。
 */
export function toPersistScheduleJobUpdate(
  current: ScheduleJobFile,
  partial: Partial<Pick<SchedulerJob, 'name' | 'description' | 'message' | 'enabled' | 'notifyOnCompletion' | 'cronExpression' | 'runAt' | 'scheduleType'>>,
): PersistScheduleJobUpdate {
  const out: PersistScheduleJobUpdate = {};
  if (partial.name !== undefined) out.name = partial.name;
  if (partial.description !== undefined) out.description = partial.description;
  if (partial.message !== undefined) out.message = partial.message;
  if (partial.enabled !== undefined) out.enabled = partial.enabled;
  if (partial.notifyOnCompletion !== undefined) out.notifyOnCompletion = partial.notifyOnCompletion;

  // schedule 字段映射：判断是否要切 schedule kind
  const targetType = partial.scheduleType ?? current.scheduleType;
  const cronChanged = partial.cronExpression !== undefined;
  const runAtChanged = partial.runAt !== undefined;
  const typeChanged = partial.scheduleType !== undefined && partial.scheduleType !== current.scheduleType;

  if (cronChanged || runAtChanged || typeChanged) {
    if (targetType === 'cron') {
      const cron = partial.cronExpression
        ?? (current.scheduleType === 'cron' ? current.cron : undefined);
      if (!cron) {
        throw new Error('toPersistScheduleJobUpdate: cronExpression required when switching to cron');
      }
      out.schedule = { kind: 'cron', cron };
    } else {
      const runAt = partial.runAt
        ?? (current.scheduleType === 'once' ? current.runAt : undefined);
      if (!runAt) {
        throw new Error('toPersistScheduleJobUpdate: runAt required when switching to once');
      }
      out.schedule = { kind: 'once', runAt };
    }
  }

  return out;
}
