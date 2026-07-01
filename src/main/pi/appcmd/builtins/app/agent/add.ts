/**
 * `agent add <name> [...] [--dry-run] [--json]`
 *
 * 由 LLM 显式构造 config 创建一个 agent。所有字段全部可选(只要 name 就能创建一个
 * 能跑的最小 agent),所以本命令不做"必填覆写"约束 —— LLM 加一行 `agent add empty-bot`
 * 也合法,后续可以再 `agent update` 补字段。
 *
 * 类比 `mcp add --transport stdio --command ...`,但 agent 没有强制必填字段。
 *
 * `--dry-run` 演练:打印 resolved config,不下盘。
 * `--json` 输出 add envelope。
 */

import {
  createAgentInternal,
  type CreateAgentArgs,
  type CreateAgentResult,
} from './kernel/createAgent';

import { COMMON_FLAGS, isDryRun, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

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
  agent add <name> [options]

DESCRIPTION
  Add a custom agent. All fields are optional except <name>.

OPTIONS
  --model <id>           AI model identifier.
  --emoji <e>            Emoji icon (default: 🤖).
  --system-prompt <txt>  Custom system prompt.
  --mcp-server <name>    Bind an MCP server. Repeatable.
  --mcp-tool <s:t>       Restrict a server's tools (e.g. "git:status"). Repeatable.
  --skill <name>         Attach a skill. Repeatable.
  --greeting <text>      Welcome message shown at chat start.
  --quick-start <q>      Quick-start card: "title|description|prompt". Repeatable.
  --dry-run              Show the would-be config without writing.
  --json                 Output the final config as JSON instead of a summary.
  --help, -h             Show this help.

EXAMPLES
  agent add my-bot --model gpt-4o-mini --system-prompt "Be concise."
  agent add my-coder --skill linting --mcp-server git --mcp-tool git:status
  agent add my-bot --quick-start "Brainstorm|Get ideas|Help me brainstorm X."
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

export async function runAdd(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`agent add: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length === 0) {
    ctx.printErr('agent add: missing required <name>.\nTry "agent add --help".\n');
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 1) {
    ctx.printErr(
      `agent add: too many positional args (${parsed.positional.length}); only <name> is accepted. Quote names with spaces.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`agent add: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const mcpServers = parseMcpServerFlag(parsed.flags['mcp-server']);
  const mcpToolResult = parseMcpToolFlag(parsed.flags['mcp-tool']);
  if (!mcpToolResult.ok) {
    ctx.printErr(`agent add: ${mcpToolResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const skills = parseSkillFlag(parsed.flags.skill);
  const quickStartResult = parseQuickStartFlag(parsed.flags['quick-start']);
  if (!quickStartResult.ok) {
    ctx.printErr(`agent add: ${quickStartResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  const greetingOverride = typeof parsed.flags.greeting === 'string' ? parsed.flags.greeting : undefined;
  const modelOverride = typeof parsed.flags.model === 'string' ? parsed.flags.model : undefined;
  const emojiOverride = typeof parsed.flags.emoji === 'string' ? parsed.flags.emoji : undefined;
  const systemPromptOverride =
    typeof parsed.flags['system-prompt'] === 'string' ? parsed.flags['system-prompt'] : undefined;

  const createArgs: CreateAgentArgs = {
    name,
    version: '1.0.0',
  };

  if (emojiOverride !== undefined) createArgs.emoji = emojiOverride;
  if (modelOverride !== undefined) createArgs.model = modelOverride;
  if (systemPromptOverride !== undefined) createArgs.system_prompt = systemPromptOverride;
  if (skills.length > 0) createArgs.skills = skills;
  if (mcpServers.length > 0) {
    createArgs.mcp_servers = buildMcpServersArray(mcpServers, mcpToolResult.filter);
  }
  const userZeroStates = buildZeroStates(greetingOverride, quickStartResult.quickStarts);
  if (userZeroStates) {
    createArgs.zero_states = userZeroStates;
  }

  if (isDryRun(parsed.flags)) {
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify({ dryRun: true, action: 'add', config: createArgs }, null, 2) + '\n',
      );
    } else {
      const summary: string[] = [
        `[dry-run] agent add "${name}" (custom).`,
        `  version:   1.0.0`,
      ];
      if (createArgs.model) summary.push(`  model:     ${createArgs.model}`);
      if (createArgs.mcp_servers && createArgs.mcp_servers.length > 0) {
        summary.push(`  mcp:       ${createArgs.mcp_servers.map((s) => s.name).join(', ')}`);
      }
      if (createArgs.skills && createArgs.skills.length > 0) {
        summary.push(`  skills:    ${createArgs.skills.join(', ')}`);
      }
      summary.push('Nothing was written. Re-run without --dry-run to apply.');
      ctx.print(summary.join('\n') + '\n');
    }
    return;
  }

  const result: CreateAgentResult = await createAgentInternal(createArgs, { signal: ctx.signal });
  if (!result.success) {
    ctx.printErr(`agent add: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(
      JSON.stringify(
        { success: true, action: 'add', name, agent_id: result.agent_id, config: createArgs },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  ctx.print(`Added custom agent "${name}" (agent_id="${result.agent_id}").\n`);
}
