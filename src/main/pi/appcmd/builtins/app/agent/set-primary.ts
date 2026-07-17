/**
 * `agent set-primary <name> [--json]`
 *
 * 把指定 agent 设为当前 profile 的 primary(列表首位,启动后默认选中)。
 *
 * 命令名 `set-primary` 用连字符 —— 与 git/npm/docker 子命令命名约定一致。
 */

import {
  setPrimaryInternal,
  type SetPrimaryResult,
} from './kernel/setPrimary';

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { validateName } from './_shared';

const HELP = `USAGE
  agent set-primary <name>

DESCRIPTION
  Set the primary agent. The primary agent appears first in the agent list
  and is the default on app startup.

OPTIONS
  --json       Output the result as JSON.
  --help, -h   Show this help.

EXAMPLES
  agent set-primary "Research Agent"
  agent set-primary my-bot --json
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runSetPrimary(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`agent set-primary: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `agent set-primary: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`agent set-primary: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const result: SetPrimaryResult = await setPrimaryInternal(
    ctx.profile.store,
    { agent_name: name },
    { signal: ctx.signal },
  );

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`agent set-primary: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  ctx.print(`${result.message}\n`);
}
