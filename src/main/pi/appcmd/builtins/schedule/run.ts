/**
 * `schedule run <job-id> [--json]`
 *
 * 立即触发一条已登记的 schedule(走与 scheduler 自动触发完全相同的链路)。
 * 一次性 job 被手动触发后会被消费、标记 completed 或 failed。
 *
 * **不破坏性** —— 是显式的 "action" 类命令,与 `kubectl run` / `systemctl
 * start` 同范式;不需要 `--yes`。
 *
 * `--dry-run` 在此**有意不实现** —— "演练触发一个 schedule" 在业务上没
 * 意义(要么就是 list 看 schedule 的配置,要么就是真触发)。和 mcp 的
 * `connect/disconnect/reconnect` 也都不支持 --dry-run 同纪律(纯
 * action,无 destructive 倾向)。
 */

import { runJobNowInternal, type RunJobNowResult } from './kernel/runJobNow';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { validateJobId } from './_shared';

const HELP = `USAGE
  schedule run <job-id>

DESCRIPTION
  Trigger a schedule immediately. Runs the same execution flow as the
  scheduler does — for one-time schedules, this consumes the run and marks
  it completed or failed.

OPTIONS
  --json       Output the result as JSON.
  --help, -h   Show this help.

EXAMPLES
  schedule run j_abc123
  schedule run j_abc123 --json
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runRun(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`schedule run: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `schedule run: expected exactly one positional <job-id>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }
  const jobIdResult = validateJobId(parsed.positional[0]);
  if (!jobIdResult.ok) {
    ctx.printErr(`schedule run: ${jobIdResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { jobId } = jobIdResult;

  const result: RunJobNowResult = await runJobNowInternal({ job_id: jobId }, { signal: ctx.signal });

  if (!result.success) {
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify(result, null, 2) + '\n');
      ctx.setExitCode(1);
      return;
    }
    ctx.printErr(`schedule run: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({ action: 'run', ...result }, null, 2) + '\n');
    return;
  }
  ctx.print(
    result.chat_session_id
      ? `${result.message}\n  chat_session: ${result.chat_session_id}\n`
      : `${result.message}\n`,
  );
}
