/**
 * `schedule update <job-id> [partial flags]`
 *
 * 部分更新一条已登记 schedule 的字段。flag 名与 `create` 对齐。
 *
 * 三态字段(`--enabled`)走 string flag(`true|false`)而非 boolean,因为
 * parseFlags 的 boolean 形态是二态(true | undefined),无法表达"显式 false"。
 *
 * `--description` 这里**不是** `create` 那种"调用动机"含义 —— update 的
 * description 是真正在改 persist 上记录的描述。
 */

import { updateJobInternal, type UpdateJobResult } from './kernel/updateJob';

import { COMMON_FLAGS, isDryRun, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { parseEnabledFlag, parseScheduleTypeFlag, validateJobId } from './_shared';

const HELP = `USAGE
  schedule update <job-id> [options]

DESCRIPTION
  Edit fields of an existing schedule. At least one --* field is required.

  Switching the schedule type:
    --schedule-type cron   reuse existing cron; clears run_at
    --schedule-type once   reuse existing run_at; clears cron_expression
  Or just pass new --cron / --at — type aligns automatically and the
  job's run state (completed/expired) is reset back to "pending" so it
  fires on the next trigger.

OPTIONS
  --name <text>            New human-readable name.
  --description <text>     New description.
  --schedule-type <kind>   "cron" or "once".
  --cron <expr>            New cron expression (forces type=cron, resets run state).
  --at <ISO>               New one-time ISO timestamp (forces type=once, resets run state).
  --message <text>         New prompt for the agent.
  --enabled <true|false>   Enable or disable future runs.
  --dry-run                Show what would change without applying.
  --json                   Output the updated job as JSON.
  --help, -h               Show this help.

EXAMPLES
  schedule update j_abc --message "Send a brief weekly digest"
  schedule update j_abc --enabled false
  schedule update j_abc --cron "0 9 * * 1-5"
  schedule update j_abc --schedule-type once --at "2026-04-01T08:00:00+08:00"
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'name', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'schedule-type', type: 'string' },
  { name: 'cron', type: 'string' },
  { name: 'at', type: 'string' },
  { name: 'message', type: 'string' },
  { name: 'enabled', type: 'string' },
];

export async function runUpdate(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`schedule update: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `schedule update: expected exactly one positional <job-id>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }
  const jobIdResult = validateJobId(parsed.positional[0]);
  if (!jobIdResult.ok) {
    ctx.printErr(`schedule update: ${jobIdResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { jobId } = jobIdResult;

  const stypeResult = parseScheduleTypeFlag(parsed.flags['schedule-type']);
  if (!stypeResult.ok) {
    ctx.printErr(`schedule update: ${stypeResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const enabledResult = parseEnabledFlag(parsed.flags.enabled);
  if (!enabledResult.ok) {
    ctx.printErr(`schedule update: ${enabledResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  const name = typeof parsed.flags.name === 'string' ? parsed.flags.name : undefined;
  const description = typeof parsed.flags.description === 'string' ? parsed.flags.description : undefined;
  const cron = typeof parsed.flags.cron === 'string' ? parsed.flags.cron : undefined;
  const at = typeof parsed.flags.at === 'string' ? parsed.flags.at : undefined;
  const message = typeof parsed.flags.message === 'string' ? parsed.flags.message : undefined;

  const updates = {
    job_id: jobId,
    name,
    description,
    schedule_type: stypeResult.type,
    cron_expression: cron,
    run_at: at,
    message,
    enabled: enabledResult.enabled,
  };

  // 至少要有一个字段(预先反查,避免无 op 走到 kernel 再返回错)
  const hasField =
    name !== undefined ||
    description !== undefined ||
    stypeResult.type !== undefined ||
    cron !== undefined ||
    at !== undefined ||
    message !== undefined ||
    enabledResult.enabled !== undefined;
  if (!hasField) {
    ctx.printErr(
      'schedule update: no fields to update. Provide at least one of: --name, --description, --schedule-type, --cron, --at, --message, --enabled.\n',
    );
    ctx.setExitCode(2);
    return;
  }

  // dry-run:展示 would-update 字段,**不**调 kernel(避免 listJobs 副作用)
  if (isDryRun(parsed.flags)) {
    const preview: Record<string, unknown> = { job_id: jobId };
    if (name !== undefined) preview.name = name;
    if (description !== undefined) preview.description = description;
    if (stypeResult.type !== undefined) preview.schedule_type = stypeResult.type;
    if (cron !== undefined) preview.cron_expression = cron;
    if (at !== undefined) preview.run_at = at;
    if (message !== undefined) preview.message = message;
    if (enabledResult.enabled !== undefined) preview.enabled = enabledResult.enabled;

    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify({ dryRun: true, action: 'update', updates: preview }, null, 2) + '\n',
      );
      return;
    }
    const lines = [`[dry-run] schedule update ${jobId}`];
    for (const [k, v] of Object.entries(preview)) {
      if (k === 'job_id') continue;
      lines.push(`  ${k.padEnd(15)} → ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    lines.push('Nothing was written. Re-run without --dry-run to apply.');
    ctx.print(lines.join('\n') + '\n');
    return;
  }

  const result: UpdateJobResult = await updateJobInternal(updates, { signal: ctx.signal });

  if (!result.success) {
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify(result, null, 2) + '\n');
      ctx.setExitCode(1);
      return;
    }
    ctx.printErr(`schedule update: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({ action: 'update', ...result }, null, 2) + '\n');
    return;
  }
  ctx.print(`${result.message}\n`);
}
