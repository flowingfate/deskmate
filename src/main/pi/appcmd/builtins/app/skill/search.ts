/**
 * `skill search <query>`
 *
 * 只读 lookup —— 按关键字搜索本地已装 skill,并标注该 skill 是否已绑定到
 * 当前 agent(`applied_to_current_agent`)。
 *
 * 与 `skill list` 的区别:`list` 是零 query 的纯枚举,不带绑定标注;
 * `search <query>` 要求关键字,换来"这个 skill 是否已经能被当前 agent
 * 调用"这一额外信息。零 query 场景请直接用 `skill list`。
 */

import {
  searchLibraryInternal,
  type SearchLibraryResult,
} from './kernel/searchLibrary';

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

const HELP = `USAGE
  skill search <query>

DESCRIPTION
  Read-only keyword search over installed skills. Unlike "skill list"
  (which enumerates everything with no filter), this also reports
  whether each match is already bound to the current agent
  ("applied_to_current_agent"). Use "skill list" for a zero-query dump.

OPTIONS
  --json        Output the raw result envelope as JSON.
  --help, -h    Show this help.

EXAMPLES
  skill search pdf
  skill search "office docs" --json
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runSearch(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`skill search: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }
  if (parsed.positional.length === 0) {
    ctx.printErr(
      'skill search: missing <query>. Use "skill list" to enumerate all installed skills.\n',
    );
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 1) {
    ctx.printErr(
      `skill search: too many positional args (${parsed.positional.length}); only one <query> is accepted. Quote queries with spaces.\n`,
    );
    ctx.setExitCode(2);
    return;
  }
  const query = parsed.positional[0];

  const result: SearchLibraryResult = await searchLibraryInternal({
    query,
    current_agent_id: ctx.agentId,
  });

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }
  if (!result.success) {
    ctx.printErr(`skill search: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }
  if (result.total_count === 0) {
    ctx.print(result.message + '\n');
    return;
  }

  const lines: string[] = [`Matches for "${query}" (${result.total_count}):`];
  for (const item of result.results) {
    const meta = item.metadata;
    const versionPart = meta.version ? ` v${meta.version}` : '';
    lines.push(`  ${meta.name}${versionPart}`);
    if (meta.description) lines.push(`    ${meta.description}`);
    if (meta.applied_to_current_agent !== undefined) {
      lines.push(`    applied_to_current_agent: ${meta.applied_to_current_agent ? 'yes' : 'no'}`);
    }
  }
  if (result.warnings && result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  ctx.print(lines.join('\n') + '\n');
}
