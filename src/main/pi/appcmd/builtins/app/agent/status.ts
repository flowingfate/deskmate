/**
 * `agent status <name> [--json]`
 *
 * 只读:查询 agent 在当前 profile 中的状态(NotAdded / Added)。
 * Added 附带 agent_id / emoji / model 等便捷字段。
 *
 * 与 `mcp status` 完全对称。
 */

import {
  getStatusInternal,
  type GetStatusResult,
} from './kernel/getStatus';

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { validateName } from './_shared';

const HELP = `USAGE
  agent status <name>

DESCRIPTION
  Show the current status of an agent. Read-only.

  Status values:
    NotAdded   not in the owning profile
    Added      installed in the owning profile

  When Added, the output also lists agent_id / emoji / model.

OPTIONS
  --json       Output the raw status object as JSON.
  --help, -h   Show this help.

EXAMPLES
  agent status "Research Agent"
  agent status my-bot --json
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runStatus(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`agent status: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `agent status: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`agent status: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const result: GetStatusResult = await getStatusInternal(
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
    ctx.printErr(`agent status: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  const lines: string[] = [`agent status "${name}": ${result.status}`];
  if (result.details?.agent_id) lines.push(`  agent_id: ${result.details.agent_id}`);
  if (result.details?.emoji) lines.push(`  emoji:   ${result.details.emoji}`);
  if (result.details?.model) lines.push(`  model:   ${result.details.model}`);
  ctx.print(lines.join('\n') + '\n');
}
