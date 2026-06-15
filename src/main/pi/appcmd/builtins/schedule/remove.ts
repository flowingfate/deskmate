/**
 * `schedule remove <job-id> --yes [--dry-run]`
 *
 * **破坏性**:从 persist 删除一条 schedule。默认拒绝执行 —— 不带 `--yes`
 * 一律 exit 1,与 `mcp remove` / `skill uninstall` 同纪律。
 *
 * `--dry-run` 优先于 `--yes` 检查 —— 演练不需要 confirmation。
 *
 * 注意:`schedule remove` 在老 LocalTool 时代**不存在**(LLM 没法删),
 * 本批迁移顺手补上,与 mcp/agent/skill 的生命周期能力面对齐。
 */

import { deleteJobInternal, type DeleteJobResult } from './kernel/deleteJob';
import { listJobsInternal } from './kernel/listJobs';

import { COMMON_FLAGS, isDryRun, isHelp, isJson, isYes } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { validateJobId } from './_shared';

const HELP = `USAGE
  schedule remove <job-id> --yes

DESCRIPTION
  Remove a schedule from your profile. This is DESTRUCTIVE — the schedule
  is cancelled and the persist record is deleted. There is no undo from
  this command.

  Always requires --yes. Without it, the command refuses.

OPTIONS
  --yes, -y    Confirm the removal. REQUIRED for the real op.
  --dry-run    Show what would be removed without doing it (no --yes needed).
  --json       Output the result as JSON.
  --help, -h   Show this help.

EXAMPLES
  schedule remove j_abc123 --dry-run
  schedule remove j_abc123 --yes
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runRemove(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`schedule remove: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `schedule remove: expected exactly one positional <job-id>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }
  const jobIdResult = validateJobId(parsed.positional[0]);
  if (!jobIdResult.ok) {
    ctx.printErr(`schedule remove: ${jobIdResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { jobId } = jobIdResult;

  // 反查存在性(给温和提示;dry-run 也用得到)
  let exists = false;
  try {
    const list = await listJobsInternal({}, { signal: ctx.signal });
    if (list.success) {
      exists = list.schedules.some((s) => s.job_id === jobId);
    }
  } catch {
    // scheduler 未就绪 → 走到下面 dry-run / 真删,各自再处理失败
  }

  if (isDryRun(parsed.flags)) {
    if (!exists) {
      if (isJson(parsed.flags)) {
        ctx.print(
          JSON.stringify(
            { dryRun: true, action: 'remove', job_id: jobId, wouldRemove: false },
            null,
            2,
          ) + '\n',
        );
        return;
      }
      ctx.print(
        `[dry-run] schedule remove "${jobId}": not found; nothing would be removed.\n`,
      );
      return;
    }
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify(
          { dryRun: true, action: 'remove', job_id: jobId, wouldRemove: true },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    ctx.print(
      `[dry-run] schedule remove "${jobId}": would cancel and delete this schedule. ` +
        'Re-run with --yes (and without --dry-run) to apply.\n',
    );
    return;
  }

  // 破坏性 op:必须 --yes
  if (!isYes(parsed.flags)) {
    ctx.printErr(
      `schedule remove: refusing without --yes. "${jobId}" was NOT removed.\n` +
        `Re-run as: schedule remove ${jobId} --yes\n`,
    );
    ctx.setExitCode(1);
    return;
  }

  const result: DeleteJobResult = await deleteJobInternal({ job_id: jobId }, { signal: ctx.signal });

  if (!result.success) {
    if (isJson(parsed.flags)) {
      ctx.print(JSON.stringify(result, null, 2) + '\n');
      ctx.setExitCode(1);
      return;
    }
    ctx.printErr(`schedule remove: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({ success: true, action: 'remove', job_id: jobId }, null, 2) + '\n');
    return;
  }
  ctx.print(`${result.message}\n`);
}
