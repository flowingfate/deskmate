/**
 * `skill search <query>` / `skill search --installed [<query>]`
 *
 * 只读 lookup,跨 3 个 source 合并 + 去重:installed / clawhub / github。
 * 单源失败被收敛进 warnings,不影响其它源的结果。
 *
 * 输出明确标注 source,LLM 看到 `clawhub` / `github` 时应当用
 * `local_folder` + `--from <source> --path` 走 device-path install。
 *
 * `--installed`:窄化为本地已装 skill 的过滤(等价 `skill list` 但加关键字)。
 * 不传 query + `--installed` 等价 `skill list`。
 */

import {
  searchLibraryInternal,
  type SearchLibraryResult,
} from './kernel/searchLibrary';
import {
  listSkillsInternal,
} from './kernel/listSkills';

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

const HELP = `USAGE
  skill search <query>           Search across 3 sources (installed / clawhub / github).
  skill search --installed       List installed skills (optionally filtered by query).

DESCRIPTION
  Read-only discovery. The cross-source path queries 3 catalogs in parallel
  and returns the merged, deduplicated list (priority: installed > clawhub
  > github). Each result is tagged with its source — always mention the
  source when answering the user.

  For clawhub / github hits, the result includes a "local_folder" you can
  pass to "skill install <name> --from clawhub|github --path <local_folder>"
  to install.

OPTIONS
  --installed   Narrow to already-installed skills (or list all when no query).
  --json        Output the raw result envelope as JSON.
  --help, -h    Show this help.

EXAMPLES
  skill search pdf
  skill search "office docs" --json
  skill search --installed
  skill search --installed pdf
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'installed', type: 'boolean' },
];

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

  const installed = parsed.flags.installed === true;

  if (installed) {
    // --installed:走 listSkillsInternal,再按可选 query 过滤
    if (parsed.positional.length > 1) {
      ctx.printErr(
        `skill search --installed: too many positional args (${parsed.positional.length}); accept 0 or 1 query.\n`,
      );
      ctx.setExitCode(2);
      return;
    }
    const list = await listSkillsInternal({ signal: ctx.signal });
    if (!list.success) {
      if (isJson(parsed.flags)) {
        ctx.print(JSON.stringify(list, null, 2) + '\n');
        ctx.setExitCode(1);
        return;
      }
      ctx.printErr(`skill search --installed: ${list.message}\n`);
      ctx.setExitCode(1);
      return;
    }
    const queryRaw = parsed.positional[0]?.trim().toLowerCase();
    const filtered = queryRaw
      ? list.skills.filter(
          (s) =>
            s.name.toLowerCase().includes(queryRaw) ||
            s.description.toLowerCase().includes(queryRaw),
        )
      : list.skills;

    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify(
          { success: true, source: 'installed', count: filtered.length, skills: filtered },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    if (filtered.length === 0) {
      ctx.print(
        queryRaw
          ? `No installed skills match "${queryRaw}".\n`
          : 'No skills installed.\n',
      );
      return;
    }
    const lines: string[] = [`Installed skills (${filtered.length}):`];
    for (const s of filtered) {
      lines.push(`  ${s.name}  (v${s.version})`);
      if (s.description) lines.push(`    ${s.description}`);
    }
    ctx.print(lines.join('\n') + '\n');
    return;
  }

  // 跨 4 源搜索路径
  if (parsed.positional.length === 0) {
    ctx.printErr(
      'skill search: missing <query>. Provide a keyword or use --installed.\n',
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
    lines.push(`  [${item.source}] ${meta.name}${versionPart}`);
    if (meta.description) lines.push(`    ${meta.description}`);
    if (meta.local_folder) lines.push(`    local_folder: ${meta.local_folder}`);
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
