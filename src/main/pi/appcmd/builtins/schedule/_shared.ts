/**
 * `schedule` 命令族的内部 helper —— 多个 subcommand 共享的小函数。
 *
 * 文件命名以 `_` 前缀,显式与"subcommand 文件"区分。helper 都是纯函数 +
 * 单一职责,**不**做任何 schedulerManager 副作用;那些都在对应 subcommand
 * 里。
 */

import type { JobView } from './kernel/types';

/**
 * 校验 job_id positional argument。`mcp` 把 `validateName` 写在 _shared,
 * 这里同纪律 —— 把"job_id 必填、非空、trim 后非空"集中一处。
 */
export function validateJobId(
  raw: string | undefined,
): { ok: true; jobId: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'missing required <job-id> argument.' };
  }
  const jobId = raw.trim();
  if (!jobId) {
    return { ok: false, error: '<job-id> must be non-empty after trim.' };
  }
  return { ok: true, jobId };
}

/**
 * 解析 `--enabled true|false` flag。boolean flag 在 parseFlags 是二态
 * (`true | undefined`,无法表达"显式 false"),但 update 需要三态语义
 * (未给 / 显式 true / 显式 false)—— 所以这里走 string flag + enum 校验
 * (与 `docker run --restart=always` 同范式)。
 */
export function parseEnabledFlag(
  raw: string | boolean | readonly string[] | undefined,
): { ok: true; enabled?: boolean } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, enabled: undefined };
  if (typeof raw !== 'string') {
    return {
      ok: false,
      error: '--enabled expects a string value: "true" or "false".',
    };
  }
  const v = raw.trim().toLowerCase();
  if (v === 'true') return { ok: true, enabled: true };
  if (v === 'false') return { ok: true, enabled: false };
  return {
    ok: false,
    error: `--enabled must be "true" or "false", got ${JSON.stringify(raw)}.`,
  };
}

/** 解析 `--schedule-type cron|once` flag。 */
export function parseScheduleTypeFlag(
  raw: string | boolean | readonly string[] | undefined,
): { ok: true; type?: 'cron' | 'once' } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, type: undefined };
  if (typeof raw !== 'string') {
    return {
      ok: false,
      error: '--schedule-type expects a string value: "cron" or "once".',
    };
  }
  const v = raw.trim().toLowerCase();
  if (v === 'cron' || v === 'once') return { ok: true, type: v };
  return {
    ok: false,
    error: `--schedule-type must be "cron" or "once", got ${JSON.stringify(raw)}.`,
  };
}

/**
 * `schedule list` 的人话渲染:一行一 job,简洁可读;与 `kubectl get jobs`
 * 风格对齐 —— LLM / 用户都能一眼看到 id / name / type / next 触发 / status。
 */
export function formatJobLine(job: JobView): string {
  const trigger =
    job.schedule_type === 'cron'
      ? `cron=${job.cron_expression || '?'}`
      : `at=${job.run_at || '?'}`;
  const lastRun = job.last_run_at ? `last=${job.last_run_at}` : 'last=-';
  const enabled = job.enabled ? 'on' : 'off';
  return `  ${job.job_id}  ${job.name}  [${job.schedule_type}/${enabled}/${job.status}]  ${trigger}  ${lastRun}`;
}
