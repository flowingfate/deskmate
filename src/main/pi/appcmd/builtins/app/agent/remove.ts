/**
 * `agent remove <name> --yes [--dry-run]`
 *
 * **破坏性**:从 profile 删除(archive)一个 agent。**默认拒绝执行** ——
 * 不带 `--yes` 一律 exit 1,与 `ai.prompt/tool-system.md` §4 "破坏性操作默认拒绝"
 * 的设计约束对齐。
 *
 * `--dry-run` 优先于 `--yes` 检查 —— 演练 dry-run 不需要 `--yes`(只是
 * 看看会做什么)。与 `mcp remove` 完全对称。
 */

import { Profiles } from '@main/persist';

import {
  removeAgentInternal,
  type RemoveAgentResult,
} from './kernel/removeAgent';

import { COMMON_FLAGS, isDryRun, isHelp, isJson, isYes } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { validateName } from './_shared';

const HELP = `USAGE
  agent remove <name> --yes

DESCRIPTION
  Remove (archive) an agent from your profile. This is DESTRUCTIVE — the agent
  is removed from the active list. There is no undo from this command (you can
  re-install with "agent install" if it is in the library).

  Always requires --yes. Without it, the command refuses.

OPTIONS
  --yes, -y    Confirm the removal. REQUIRED for the real op.
  --dry-run    Show what would be removed without doing it (no --yes needed).
  --json       Output the result as JSON.
  --help, -h   Show this help.

EXAMPLES
  agent remove my-bot --dry-run
  agent remove my-bot --yes
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runRemove(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`agent remove: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `agent remove: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`agent remove: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  // 确认 agent 存在(给一个温和提示;dry-run 也应该有这个反馈)
  let exists = false;
  try {
    const profile = await Profiles.get().active();
    exists = profile.listAgents().some((r) => r.name === name);
  } catch {
    // profile 未就绪 —— 走到下面 dry-run / 真删,各自再处理失败
  }

  if (isDryRun(parsed.flags)) {
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify(
          { dryRun: true, action: 'remove', name, wouldRemove: exists },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    if (exists) {
      ctx.print(`[dry-run] would archive agent "${name}".\nRe-run with --yes to apply.\n`);
    } else {
      ctx.print(`[dry-run] agent "${name}" is NOT installed; nothing would be removed.\n`);
    }
    return;
  }

  // 破坏性 op:必须 --yes
  if (!isYes(parsed.flags)) {
    ctx.printErr(
      `agent remove: refusing without --yes.\n` +
        `Agent "${name}" was NOT removed. Re-run with --yes to confirm:\n` +
        `  agent remove ${JSON.stringify(name)} --yes\n`,
    );
    ctx.setExitCode(1);
    return;
  }

  if (!exists) {
    ctx.printErr(`agent remove: agent "${name}" is not installed.\n`);
    ctx.setExitCode(1);
    return;
  }

  const result: RemoveAgentResult = await removeAgentInternal(
    { agent_name: name },
    { signal: ctx.signal },
  );
  if (!result.success) {
    ctx.printErr(`agent remove: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(
      JSON.stringify(
        { success: true, action: 'remove', name, agent_id: result.agent_id },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  ctx.print(`Removed agent "${name}".\n`);
}
