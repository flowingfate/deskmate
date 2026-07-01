/**
 * `skill bind <skill-name> [--agent-name <name> ...] [--all-agents] [--dry-run] [--json]`
 *
 * 把已安装的 skill 绑到 agent。
 *
 * 默认 target:不带 `--agent-name` / `--all-agents` 时,绑到**当前 chat 的
 * agent**(`ctx.agentId`)。这是 LLM 在聊天里说"装这个 skill"时最直觉的
 * 行为。
 *
 * 与老 `apply_skill_to_agents` 工具的差别:**不**自动 install 未装 skill ——
 * shell 范式分离的纪律(`systemctl enable` 不会自动 `apt install`)。先
 * `skill install <name>` 再 `skill bind <name>`。kernel 已加未装拒绝守门。
 */

import {
  bindSkillInternal,
  type BindSkillResult,
} from './kernel/bindSkill';

import { COMMON_FLAGS, isDryRun, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { normalizeArrayFlag, resolveDefaultAgentTarget, validateName } from './_shared';

const HELP = `USAGE
  skill bind <skill-name> [options]

DESCRIPTION
  Attach an installed skill to one or more agents. If no targeting flag is
  given, bind to the current chat's agent.

  The skill must already be installed locally. Run "skill install <name>"
  first if it is not. Use "skill list" or "skill status <name>" to check.

OPTIONS
  --agent-name <n>   Target the named agent. Repeatable to bind multiple.
  --all-agents       Bind to every agent in the active profile.
  --dry-run          Show resolved targets without writing.
  --json             Output the bind envelope as JSON.
  --help, -h         Show this help.

NOTES
  --agent-name and --all-agents are mutually exclusive. When neither is
  given, the default target is the current chat agent.

EXAMPLES
  skill bind pptx                            # bind to current chat agent
  skill bind pptx --agent-name "Deck Builder"
  skill bind pptx --agent-name a --agent-name b
  skill bind pptx --all-agents
  skill bind pptx --dry-run --json
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'agent-name', type: 'array' },
  { name: 'all-agents', type: 'boolean' },
];

export async function runBind(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`skill bind: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `skill bind: expected exactly one <skill-name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0], '<skill-name>');
  if (!nameResult.ok) {
    ctx.printErr(`skill bind: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name: skillName } = nameResult;

  const agentNames = normalizeArrayFlag(parsed.flags['agent-name']);
  const allAgents = parsed.flags['all-agents'] === true;

  if (allAgents && agentNames.length > 0) {
    ctx.printErr(
      `skill bind: --all-agents and --agent-name are mutually exclusive.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  // Resolve target description for dry-run / human output.
  let targetDesc: string;
  let bindArgs: Parameters<typeof bindSkillInternal>[0];
  if (allAgents) {
    targetDesc = 'all agents';
    bindArgs = { skill_name: skillName, apply_to_all: true };
  } else if (agentNames.length > 0) {
    targetDesc = `agent(s) [${agentNames.join(', ')}]`;
    bindArgs = { skill_name: skillName, agent_names: agentNames };
  } else {
    const def = await resolveDefaultAgentTarget(ctx.agentId);
    if (!def.ok) {
      ctx.printErr(`skill bind: ${def.error}\n`);
      ctx.setExitCode(1);
      return;
    }
    targetDesc = `current agent "${def.targets[0].agentName}"`;
    bindArgs = { skill_name: skillName, targets: def.targets };
  }

  if (isDryRun(parsed.flags)) {
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify(
          { dryRun: true, action: 'bind', skill_name: skillName, target: targetDesc },
          null,
          2,
        ) + '\n',
      );
      return;
    }
    ctx.print(
      `[dry-run] skill bind "${skillName}" → ${targetDesc}.\nNothing was written. Re-run without --dry-run to apply.\n`,
    );
    return;
  }

  const result: BindSkillResult = await bindSkillInternal(bindArgs, {
    signal: ctx.signal,
  });

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`skill bind: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  const lines: string[] = [
    `Bound skill "${result.skill_name}" → ${targetDesc}.`,
    `  applied: ${result.applied_count}`,
  ];
  if (result.already_applied_count > 0) lines.push(`  already applied: ${result.already_applied_count}`);
  if (result.failed_count > 0) lines.push(`  failed: ${result.failed_count}`);
  ctx.print(lines.join('\n') + '\n');
}
