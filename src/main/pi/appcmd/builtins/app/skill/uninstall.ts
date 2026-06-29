/**
 * `skill uninstall <name>... --yes [--dry-run] [--json]`
 *
 * **破坏性**:从设备卸载已安装 skill。**默认拒绝执行** —— 不带 `--yes` 一律
 * exit 1,与 `ai.prompt/tool-system.md` §4 "破坏性操作默认拒绝" 对齐。
 *
 * **不**动 agent 配置:agent.skills 列表里若残留该 skill name,执行后 LLM 调用
 * 会失败但不会自动清理。要同时解绑请显式跑 `skill unbind`。
 *
 * `--dry-run` 优先于 `--yes` 检查 —— 演练不需要 `--yes`。与 `agent remove`
 * / `mcp remove` 完全对称。
 *
 * 支持一次卸载多个 skill:positional 全部视作 skill name。
 */

import { Profiles } from '@main/persist';

import {
  uninstallSkillInternal,
  type UninstallSkillResult,
} from './kernel/uninstallSkill';

import { COMMON_FLAGS, isDryRun, isHelp, isJson, isYes } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { normalizeSkillNames } from './_shared';

const HELP = `USAGE
  skill uninstall <name>... --yes

DESCRIPTION
  Uninstall one or more skills from the local device. This is DESTRUCTIVE —
  the skill is removed from your profile's global skill list AND its local
  package directory is deleted from disk.

  Agent skill bindings (agent.skills array entries) are NOT touched —
  bound agents will fail to invoke the skill until you also run
  "skill unbind". Conversely, "skill unbind" alone does not delete the
  local skill package.

  Always requires --yes. Without it, the command refuses. Built-in skills
  cannot be uninstalled.

OPTIONS
  --yes, -y     Confirm the uninstall. REQUIRED for the real op.
  --dry-run     Show what would be uninstalled without doing it (no --yes needed).
  --json        Output the result as JSON.
  --help, -h    Show this help.

EXAMPLES
  skill uninstall my-tool --dry-run
  skill uninstall my-tool --yes
  skill uninstall a b c --yes
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runUninstall(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`skill uninstall: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length === 0) {
    ctx.printErr('skill uninstall: missing required <name>(s).\nTry "skill uninstall --help".\n');
    ctx.setExitCode(2);
    return;
  }

  const namesResult = normalizeSkillNames(parsed.positional);
  if (!namesResult.ok) {
    ctx.printErr(`skill uninstall: ${namesResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { names } = namesResult;

  // 提供 dry-run 友好的"哪些真的会被删"提示。
  let installedSet = new Set<string>();
  try {
    const profile = Profiles.get().activeSync();
    installedSet = new Set(profile.skills.items.map((s) => s.name));
  } catch {
    // profile 未就绪 —— 走到下面 dry-run / real-uninstall,各自再处理。
  }

  if (isDryRun(parsed.flags)) {
    const wouldRemove = names.filter((n) => installedSet.has(n));
    const wouldSkip = names.filter((n) => !installedSet.has(n));
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify(
          { dryRun: true, action: 'uninstall', wouldRemove, wouldSkip },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    const lines: string[] = [`[dry-run] skill uninstall (${names.length} requested):`];
    if (wouldRemove.length > 0) lines.push(`  would remove: ${wouldRemove.join(', ')}`);
    if (wouldSkip.length > 0) lines.push(`  not installed: ${wouldSkip.join(', ')}`);
    if (wouldRemove.length === 0) {
      lines.push('Nothing would be removed. Re-run with --yes (and without --dry-run) to apply.');
    } else {
      lines.push('Re-run with --yes (and without --dry-run) to apply.');
    }
    ctx.print(lines.join('\n') + '\n');
    return;
  }

  // 破坏性 op:必须 --yes
  if (!isYes(parsed.flags)) {
    ctx.printErr(
      `skill uninstall: refusing without --yes.\n` +
        `Skills [${names.join(', ')}] were NOT uninstalled. Re-run with --yes to confirm:\n` +
        `  skill uninstall ${names.join(' ')} --yes\n`,
    );
    ctx.setExitCode(1);
    return;
  }

  const result: UninstallSkillResult = await uninstallSkillInternal(
    { skill_names: names },
    { signal: ctx.signal },
  );

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`skill uninstall: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  const lines: string[] = [result.message];
  if (result.uninstalled_skills.length > 0) {
    lines.push(`  uninstalled: ${result.uninstalled_skills.join(', ')}`);
  }
  if (result.skipped_skills.length > 0) {
    lines.push(
      `  skipped:     ${result.skipped_skills
        .map((s) => `${s.skill_name} (${s.reason})`)
        .join(', ')}`,
    );
  }
  ctx.print(lines.join('\n') + '\n');
}
