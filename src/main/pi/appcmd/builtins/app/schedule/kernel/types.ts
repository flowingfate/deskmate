/**
 * Schedule 内核共享类型 —— kernel/* 全部 `*Internal()` 函数返回的 envelope
 * + `JobView`(LLM-facing snake_case schedule 投影)的唯一定义点。
 */
import type { SchedulerJob } from '@shared/ipc/scheduler';

/** LLM-facing schedule projection. */
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
  last_started_at?: string;
}

export function jobToView(job: SchedulerJob): JobView {
  const base = {
    job_id: job.id,
    name: job.name,
    description: job.description,
    message: job.message,
    agent_id: job.agentId,
    enabled: job.enabled,
    last_started_at: job.lastStartedAt,
  };
  if (job.scheduleType === 'cron') {
    return { ...base, schedule_type: 'cron', cron_expression: job.cronExpression };
  }
  return { ...base, schedule_type: 'once', run_at: job.runAt };
}
