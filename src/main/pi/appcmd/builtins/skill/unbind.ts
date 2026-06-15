/**
 * `skill unbind <skill-name>... [--agent-name <name> ...] [--all-agents] [--dry-run] [--json]`
 *
 * 从 agent 配置里解绑 skill。**不**卸载本地包(由 `uninstall` 负责)。
 *
 * 默认 target:不带 `--agent-name` / `--all-agents` 时,从当前 chat 的 agent
 * 解绑(`ctx.agentId`)。
 *
 * 支持一次解绑多个 skill:positional 全部视作 skill name。
 */

import {
  unbindSkillInternal,
  type UnbindSkillResult,
} from './kernel/unbindSkill';

import { COMMON_FLAGS, isDryRun, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { normalizeArrayFlag, normalizeSkillNames, resolveDefaultAgentTarget } from './_shared';

const HELP = `USAGE
  skill unbind <skill-name>... [options]

DESCRIPTION
  Detach one or more skills from agent configurations. The local skill
  package is NOT removed — use "skill uninstall" for that.

  If no targeting flag is given, unbind from the current chat's agent.

OPTIONS
  --agent-name <n>   Target the named agent. Repeatable.
  --all-agents       Unbind from every agent in the active profile.
  --dry-run          Show resolved targets without writing.
  --json             Output the unbind envelope as JSON.
  --help, -h         Show this help.

NOTES
  --agent-name and --all-agents are mutually exclusive. When neither is
  given, the default target is the current chat agent.

EXAMPLES
  skill unbind pptx                          # unbind from current chat agent
  skill unbind pptx --agent-name "Deck Builder"
  skill unbind pptx jira --all-agents
  skill unbind pptx --dry-run --json
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'agent-name', type: 'array' },
  { name: 'all-agents', type: 'boolean' },
];

export async function runUnbind(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`skill unbind: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length === 0) {
    ctx.printErr('skill unbind: missing required <skill-name>(s).\nTry "skill unbind --help".\n');
    ctx.setExitCode(2);
    return;
  }

  const namesResult = normalizeSkillNames(parsed.positional);
  if (!namesResult.ok) {
    ctx.printErr(`skill unbind: ${namesResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { names: skillNames } = namesResult;

  const agentNames = normalizeArrayFlag(parsed.flags['agent-name']);
  const allAgents = parsed.flags['all-agents'] === true;

  if (allAgents && agentNames.length > 0) {
    ctx.printErr(
      `skill unbind: --all-agents and --agent-name are mutually exclusive.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  let targetDesc: string;
  let unbindArgs: Parameters<typeof unbindSkillInternal>[0];
  if (allAgents) {
    targetDesc = 'all agents';
    unbindArgs = { skill_names: skillNames, remove_from_all: true };
  } else if (agentNames.length > 0) {
    targetDesc = `agent(s) [${agentNames.join(', ')}]`;
    unbindArgs = { skill_names: skillNames, agent_names: agentNames };
  } else {
    const def = await resolveDefaultAgentTarget(ctx.agentId);
    if (!def.ok) {
      ctx.printErr(`skill unbind: ${def.error}\n`);
      ctx.setExitCode(1);
      return;
    }
    targetDesc = `current agent "${def.targets[0].agentName}"`;
    unbindArgs = { skill_names: skillNames, targets: def.targets };
  }

  if (isDryRun(parsed.flags)) {
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify(
          { dryRun: true, action: 'unbind', skill_names: skillNames, target: targetDesc },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    ctx.print(
      `[dry-run] skill unbind [${skillNames.join(', ')}] ← ${targetDesc}.\nNothing was written. Re-run without --dry-run to apply.\n`,
    );
    return;
  }

  const result: UnbindSkillResult = await unbindSkillInternal(unbindArgs, {
    signal: ctx.signal,
  });

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`skill unbind: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  const lines: string[] = [
    `Unbound skill(s) [${result.skill_names.join(', ')}] ← ${targetDesc}.`,
    `  updated agents: ${result.updated_agent_count}`,
    `  removed bindings: ${result.removed_binding_count}`,
  ];
  if (result.unchanged_target_count > 0)
    lines.push(`  unchanged: ${result.unchanged_target_count}`);
  if (result.failed_count > 0) lines.push(`  failed: ${result.failed_count}`);
  ctx.print(lines.join('\n') + '\n');
}
