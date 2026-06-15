/**
 * Schedule 内核共享类型 —— kernel/* 全部 `*Internal()` 函数返回的 envelope
 * + `JobView`(LLM-facing snake_case schedule 投影)的唯一定义点。
 *
 * 设计:
 * - `JobView` 故意与 persist 的 `SchedulerJob`(camelCase)解耦 —— LLM 看到
 *   的是 shell/JSON 圈的 snake_case 习惯,与 mcp / agent / skill 域 `--json`
 *   输出一致;`vestigial` 字段(老 schema 里的 `messages_count`)**不**搬。
 * - `OkEnvelope<T>` / `ErrEnvelope` 是 kernel 的统一错误模式:**不抛错**,
 *   按 success 字段分支;caller(appcmd subcommand)按 `success === false`
 *   走 `ctx.printErr + setExitCode(1)`。
 */
import type { SchedulerJob } from '@main/lib/scheduler/types';

/** LLM-facing schedule 投影。snake_case;`adapter-only` 字段(executedAt 等)不暴露。 */
export interface JobView {
  job_id: string;
  name: string;
  description: string;
  schedule_type: 'cron' | 'once';
  cron_expression?: string;
  run_at?: string;
  message: string;
  agent_id: string;
  enabled: boolean;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  last_run_at?: string;
}

export function jobToView(job: SchedulerJob): JobView {
  return {
    job_id: job.id,
    name: job.name,
    description: job.description,
    schedule_type: job.scheduleType,
    cron_expression: job.cronExpression,
    run_at: job.runAt,
    message: job.message,
    agent_id: job.agentId,
    enabled: job.enabled,
    status: job.status,
    last_run_at: job.lastRunAt,
  };
}
