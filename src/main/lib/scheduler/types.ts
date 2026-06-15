/**
 * Scheduler IPC contract types — 旧扁平形状，保留兼容 renderer / mcpRuntime tools。
 *
 * 真值在 `src/main/persist/schedule.ts`：`ScheduleJobFile` (discriminated union by `scheduleType`)
 * + 独立 `JobRunState` (`pending` / `running` / `completed` / `failed`)。`jobAdapter.ts` 双向投射。
 *
 * ⚠️ Adapter-only 字段（IPC 出口看着像状态，实际不在 persist 上）：
 *   - `status: 'expired'` —— 由 adapter 在 `enabled=false && once && runState.status='pending'`
 *     时反推出来。persist 无 expired 状态机。
 *   - `executedAt` —— 旧 chat 时代字段，adapter 永远填 undefined。
 *   - `lastFinishedAt` —— 等价 `runState.finishedAt`，renderer 暂未消费。
 *   - update payload 里的 `status` / `lastRunAt` / `executedAt` 会被 adapter 静默丢弃
 *     （runState 由 startRun/finishRun 自管，外部 mutate 无语义）。
 */

export type SchedulerJobType = 'cron' | 'once';

export type SchedulerJobStatus = 'pending' | 'completed' | 'expired' | 'failed';

export interface SchedulerJob {
  /** Persist-generated ULID (`j_*`). */
  id: string;
  /** Task description */
  description: string;
  /** Human-readable name */
  name: string;
  /** Schedule type */
  scheduleType: SchedulerJobType;
  /** node-cron expression, required for recurring jobs */
  cronExpression?: string;
  /** ISO timestamp, required for one-time jobs */
  runAt?: string;
  /** Whether the job is enabled */
  enabled: boolean;
  /** Owning agent id (ULID `a_*`). */
  agentId: string;
  /** Prompt to send as the first message when triggered */
  message: string;
  /** Adapter-projected; see header note for `expired`. */
  status: SchedulerJobStatus;
  /** Last execution attempt time (= runState.startedAt). */
  lastRunAt?: string;
  /** Last execution finish time (= runState.finishedAt). Currently unused by renderer. */
  lastFinishedAt?: string;
  /** Legacy field; adapter always returns undefined. */
  executedAt?: string;
  /** Whether to send a notification on completion. Defaults to true. */
  notifyOnCompletion?: boolean;
}

export type ScheduleJobUpdate = Partial<SchedulerJob>;

export type ScheduleJobCreateInput = Omit<SchedulerJob, 'id'> & { id?: string };

export function isSchedulerJobStatus(value: unknown): value is SchedulerJobStatus {
  return value === 'pending' || value === 'completed' || value === 'expired' || value === 'failed';
}

export function isSchedulerJobType(value: unknown): value is SchedulerJobType {
  return value === 'cron' || value === 'once';
}

export function normalizeSchedulerJob(job: Partial<SchedulerJob> & Pick<SchedulerJob, 'id'>): SchedulerJob {
  return {
    id: typeof job.id === 'string' ? job.id : '',
    description: typeof job.description === 'string' ? job.description : '',
    name: typeof job.name === 'string' ? job.name : '',
    scheduleType: job.scheduleType === 'once' ? 'once' : 'cron',
    cronExpression: typeof job.cronExpression === 'string' ? job.cronExpression : undefined,
    runAt: typeof job.runAt === 'string' ? job.runAt : undefined,
    enabled: typeof job.enabled === 'boolean' ? job.enabled : true,
    agentId: typeof job.agentId === 'string' ? job.agentId : '',
    message: typeof job.message === 'string' ? job.message : '',
    status: isSchedulerJobStatus(job.status) ? job.status : 'pending',
    lastRunAt: typeof job.lastRunAt === 'string' ? job.lastRunAt : undefined,
    lastFinishedAt: typeof job.lastFinishedAt === 'string' ? job.lastFinishedAt : undefined,
    executedAt: typeof job.executedAt === 'string' ? job.executedAt : undefined,
    notifyOnCompletion: typeof job.notifyOnCompletion === 'boolean' ? job.notifyOnCompletion : true,
  };
}
