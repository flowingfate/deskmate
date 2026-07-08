/**
 * `mcp remove <name> --yes [--dry-run]`
 *
 * **破坏性**:从 profile 删除一个 MCP server。**默认拒绝执行** —— 不带
 * `--yes` 一律 exit 1,与 `ai.prompt/tool-system.md` §4 "破坏性操作默认拒绝"
 * 的设计约束对齐。
 *
 * `--dry-run` 优先于 `--yes` 检查 —— 演练 dry-run 不需要 `--yes`(只是
 * 看看会做什么)。
 */

import { mcpClientManager } from '@main/lib/mcpRuntime'
import { Profiles } from '@main/persist';

import { COMMON_FLAGS, isDryRun, isHelp, isJson, isYes } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { validateName } from './_shared';

const HELP = `USAGE
  mcp remove <name> --yes

DESCRIPTION
  Remove an MCP server from your profile. This is DESTRUCTIVE — the server
  is disconnected and the config is deleted. There is no undo from this
  command (you can re-install with "mcp install" if it is in the library).

  Always requires --yes. Without it, the command refuses.

OPTIONS
  --yes, -y    Confirm the removal. REQUIRED for the real op.
  --dry-run    Show what would be removed without doing it (no --yes needed).
  --json       Output the result as JSON.
  --help, -h   Show this help.

EXAMPLES
  mcp remove brave-search --dry-run
  mcp remove brave-search --yes
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runRemove(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`mcp remove: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `mcp remove: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`mcp remove: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  // 确认 server 存在(给一个温和提示;dry-run 也应该有这个反馈)
  let exists = false;
  try {
    const profile = await Profiles.get().active();
    exists = profile.mcp.get(name) !== undefined;
  } catch {
    // profile 未就绪 —— 走到下面 dry-run / 真删,各自再处理失败
  }

  if (isDryRun(parsed.flags)) {
    if (!exists) {
      ctx.print(
        `[dry-run] mcp remove "${name}": server is NOT installed; nothing would be removed.\n`,
      );
      return;
    }
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify({ dryRun: true, action: 'remove', name, wouldRemove: true }, null, 2) + '\n',
      );
      return;
    }
    ctx.print(
      `[dry-run] mcp remove "${name}": would disconnect and delete the config. ` +
        'Re-run with --yes (and without --dry-run) to apply.\n',
    );
    return;
  }

  // 破坏性 op:必须 --yes
  if (!isYes(parsed.flags)) {
    ctx.printErr(
      `mcp remove: refusing without --yes. "${name}" was NOT removed.\n` +
        'Re-run as: mcp remove ' + name + ' --yes\n',
    );
    ctx.setExitCode(1);
    return;
  }

  if (!exists) {
    ctx.printErr(`mcp remove: server "${name}" is not installed; nothing to do.\n`);
    ctx.setExitCode(1);
    return;
  }

  try {
    await mcpClientManager.delete(name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.printErr(`mcp remove: failed to remove "${name}": ${msg}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({ success: true, action: 'remove', name }, null, 2) + '\n');
    return;
  }
  ctx.print(`Removed MCP server "${name}".\n`);
}
