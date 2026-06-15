/**
 * `skill status <name> [--json]`
 *
 * 只读:查询单个 skill 的状态(NotInstalled / Installed)。
 * Installed 附带 version / source / description / 当前 agent 是否已绑定。
 *
 * 与 `agent status` 对称设计。
 */

import {
  getSkillStatusInternal,
  type GetSkillStatusResult,
} from './kernel/getSkillStatus';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { validateName } from './_shared';

const HELP = `USAGE
  skill status <name>

DESCRIPTION
  Show the current status of a skill in the active profile. Read-only.

  Status values:
    NotInstalled   not installed on the device
    Installed      installed; details include version / source / applied_to_current_agent

OPTIONS
  --json       Output the raw status object as JSON.
  --help, -h   Show this help.

EXAMPLES
  skill status pptx
  skill status my-tool --json
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runStatus(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`skill status: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `skill status: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`skill status: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const result: GetSkillStatusResult = await getSkillStatusInternal(
    { skill_name: name, current_agent_id: ctx.agentId },
    { signal: ctx.signal },
  );

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`skill status: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  const lines: string[] = [`skill status "${name}": ${result.status}`];
  if (result.details?.version) lines.push(`  version: ${result.details.version}`);
  if (result.details?.description) lines.push(`  desc:    ${result.details.description}`);
  if (result.details?.applied_to_current_agent !== undefined) {
    lines.push(
      `  applied_to_current_agent: ${result.details.applied_to_current_agent ? 'yes' : 'no'}`,
    );
  }
  ctx.print(lines.join('\n') + '\n');
}
