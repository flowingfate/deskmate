/**
 * `skill list [--json]`
 *
 * 只读:列出 active profile 内所有已安装 skill,带版本 / source / description。
 *
 * 与 `skill search <query>` 的区别:`list` 是纯枚举(零 query,无绑定标注),
 * `search` 要求关键字,换来 `applied_to_current_agent` 标注。LLM 想"我都
 * 装了啥"用 `list`;想"有没有装跟 X 相关的、且能不能被当前 agent 用"用
 * `search <query>`。
 */

import {
  listSkillsInternal,
  type ListSkillsResult,
} from './kernel/listSkills';

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

const HELP = `USAGE
  skill list

DESCRIPTION
  List all skills installed in the active profile. Read-only.

OPTIONS
  --json       Output the result as JSON.
  --help, -h   Show this help.

EXAMPLES
  skill list
  skill list --json
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runList(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`skill list: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length > 0) {
    ctx.printErr(
      `skill list: takes no positional arguments, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const result: ListSkillsResult = await listSkillsInternal({ signal: ctx.signal });

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`skill list: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (result.count === 0) {
    ctx.print('No skills installed.\n');
    return;
  }

  const lines: string[] = [`${result.count} skill(s):`];
  for (const s of result.skills) {
    lines.push(`  ${s.name}  (v${s.version})`);
    if (s.description) lines.push(`    ${s.description}`);
  }
  ctx.print(lines.join('\n') + '\n');
}
