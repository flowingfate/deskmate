/**
 * `agent update <name> [partial flags] [--json]`
 *
 * 更新一个**已安装**的 agent 的部分字段。语义:
 *   - 只携带 `--xxx` 的字段被更新;其它保留
 *   - version 由 `updateAgentInternal` 自动 patch+1
 *   - mcp_servers / skills 整体替换
 */

import { Profiles } from '@main/persist';

import {
  updateAgentInternal,
  type UpdateAgentArgs,
  type UpdateAgentResult,
} from './kernel/updateAgent';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import {
  buildMcpServersArray,
  buildZeroStates,
  parseMcpServerFlag,
  parseMcpToolFlag,
  parseQuickStartFlag,
  parseSkillFlag,
  validateName,
} from './_shared';

const HELP = `USAGE
  agent update <name> [options]

DESCRIPTION
  Update fields of an already-installed agent. Only the flags you pass are
  changed; everything else is kept. Version is bumped automatically.

OPTIONS
  --model <id>           AI model identifier.
  --emoji <e>            Emoji icon.
  --system-prompt <txt>  System prompt.
  --mcp-server <name>    Bind an MCP server. Repeatable. Replaces current list.
  --mcp-tool <s:t>       Restrict a server's tools (e.g. "git:status"). Repeatable.
  --skill <name>         Attach a skill. Repeatable. Replaces current list.
  --greeting <text>      Welcome message shown at chat start.
  --quick-start <q>      Quick-start card: "title|description|prompt". Repeatable.
  --json                 Output the result as JSON.
  --help, -h             Show this help.

EXAMPLES
  agent update my-bot --model gpt-4o
  agent update "Research Agent" --skill arxiv --skill web-search
  agent update my-bot --greeting "Welcome back!"
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'model', type: 'string' },
  { name: 'emoji', type: 'string' },
  { name: 'system-prompt', type: 'string' },
  { name: 'mcp-server', type: 'array' },
  { name: 'mcp-tool', type: 'array' },
  { name: 'skill', type: 'array' },
  { name: 'greeting', type: 'string' },
  { name: 'quick-start', type: 'array' },
];

export async function runUpdate(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`agent update: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `agent update: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`agent update: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const mcpServers = parseMcpServerFlag(parsed.flags['mcp-server']);
  const mcpToolResult = parseMcpToolFlag(parsed.flags['mcp-tool']);
  if (!mcpToolResult.ok) {
    ctx.printErr(`agent update: ${mcpToolResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const skills = parseSkillFlag(parsed.flags.skill);
  const quickStartResult = parseQuickStartFlag(parsed.flags['quick-start']);
  if (!quickStartResult.ok) {
    ctx.printErr(`agent update: ${quickStartResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  try {
    const profile = await Profiles.get().active();
    const records = profile.listAgents();
    const rec = records.find((r) => r.name === name);
    if (!rec) {
      ctx.printErr(
        `agent update: agent "${name}" is not installed. ` +
          'Hint: use "app agent add" first.\n',
      );
      ctx.setExitCode(1);
      return;
    }
  } catch (err) {
    ctx.printErr(
      `agent update: failed to load profile: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    ctx.setExitCode(1);
    return;
  }

  // 构造 patch payload。每个 flag 都用"flag 显式给了才设" 的语义,与
  // kernel 的"undefined 跳过赋值"约定对接。
  const agentConfig: UpdateAgentArgs['agent_config'] = { name };

  if (typeof parsed.flags.emoji === 'string') agentConfig.emoji = parsed.flags.emoji;
  if (typeof parsed.flags.model === 'string') agentConfig.model = parsed.flags.model;
  if (typeof parsed.flags['system-prompt'] === 'string') {
    agentConfig.system_prompt = parsed.flags['system-prompt'];
  }
  if (mcpServers.length > 0) {
    agentConfig.mcp_servers = buildMcpServersArray(mcpServers, mcpToolResult.filter);
  }
  if (skills.length > 0) {
    agentConfig.skills = skills;
  }

  const greetingGiven = typeof parsed.flags.greeting === 'string';
  const quickStartsGiven = quickStartResult.quickStarts !== undefined;
  if (greetingGiven || quickStartsGiven) {
    const greeting = greetingGiven ? (parsed.flags.greeting as string) : undefined;
    agentConfig.zero_states = buildZeroStates(greeting, quickStartResult.quickStarts);
  }

  const result: UpdateAgentResult = await updateAgentInternal(
    { agent_config: agentConfig },
    { signal: ctx.signal },
  );

  if (!result.success) {
    ctx.printErr(`agent update: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(
      JSON.stringify(
        {
          success: true,
          action: 'update',
          name,
          old_version: result.old_version,
          new_version: result.new_version,
          patch: agentConfig,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  ctx.print(`Updated agent "${name}". ${result.message}\n`);
}
