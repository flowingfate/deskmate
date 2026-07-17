/**
 * `agent list [--json]`
 *
 * 只读:列出 owning Profile 内所有 agent 名(去重)。
 *
 * 与 `agent search --installed` 的区别:`list` 只回名字(更轻量),`search --installed`
 * 回名字 + 状态等元信息。LLM 想纯列表用 `list`;想看状态详情用 `search --installed`。
 */

import {
  listAgentsInternal,
  type ListAgentsResult,
} from './kernel/listAgents';

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

const HELP = `USAGE
  agent list

DESCRIPTION
  List all installed agent names (deduplicated). Read-only.

OPTIONS
  --json       Output the result as JSON.
  --help, -h   Show this help.

EXAMPLES
  agent list
  agent list --json
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runList(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`agent list: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length > 0) {
    ctx.printErr(
      `agent list: takes no positional arguments, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const result: ListAgentsResult = await listAgentsInternal(ctx.profile.store, { signal: ctx.signal });

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`agent list: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (result.count === 0) {
    ctx.print('No agents installed.\n');
    return;
  }
  ctx.print(`${result.count} agent(s):\n` + result.agents.map((a) => `  - ${a}`).join('\n') + '\n');
}
