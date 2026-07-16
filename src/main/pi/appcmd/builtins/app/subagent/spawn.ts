/**
 * `subagent spawn <name> "<task>" [--share-context] [--json]`
 *
 * 把任务委派给单个已注册的 sub-agent。**read-async-heavy op**:
 *   - 默认输出 JSON envelope —— renderer view 与 LLM 都依赖结构化字段。
 *   - `--share-context` 仅当 sub-agent 的 `context_access !== 'isolated'`
 *     时才真正注入父上下文摘要,与老 `spawn_subagent.share_context` 等价。
 *   - 失败统一 envelope `{ success: false, error }` + exit 1。
 *
 * 与 `spawn-many` 的关系:本命令是 spawn-many 的 1-task 退化;为了 LLM
 * 母语友好(`spawn <name> "<task>"` 远比 `spawn-many --task "name:..."`
 * 容易写)单独保留。
 */
import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { spawnSingleInternal } from './kernel/spawn';
import { ensureSpawnPrerequisites } from './_shared';

const HELP = `USAGE
  subagent spawn <name> <task> [options]

DESCRIPTION
  Spawn a registered sub-agent to handle a specific task autonomously. The
  sub-agent runs independently to completion and returns its result.

  <name> must match a sub-agent registered for this agent (see
  "subagent list" — TODO future). <task> is the description handed to the
  sub-agent as its initial user message; quote it if it contains spaces.

OPTIONS
  --share-context    Pass the parent context summary to the sub-agent.
                     Ignored when the sub-agent's context_access is
                     "isolated".
  --json             Output the result envelope as JSON (default form is
                     already JSON; flag accepted for forward-compat with
                     other commands).
  --help, -h         Show this help.

EXAMPLES
  subagent spawn researcher "Find the latest papers on diffusion LLMs."
  subagent spawn coder "Refactor the login flow." --share-context
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'share-context', type: 'boolean' },
];

export async function runSpawn(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`subagent spawn: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length < 2) {
    ctx.printErr(
      'subagent spawn: requires <name> and <task>. ' +
        'Quote the task if it contains spaces.\n' +
        'Try "subagent spawn --help".\n',
    );
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 2) {
    ctx.printErr(
      `subagent spawn: too many positional args (${parsed.positional.length}); ` +
        'only <name> and <task> are accepted. Quote multi-word <task>.\n',
    );
    ctx.setExitCode(2);
    return;
  }

  const name = parsed.positional[0].trim();
  const task = parsed.positional[1];
  if (!name) {
    ctx.printErr('subagent spawn: <name> must be non-empty after trim.\n');
    ctx.setExitCode(2);
    return;
  }
  if (!task.trim()) {
    ctx.printErr('subagent spawn: <task> must be non-empty after trim.\n');
    ctx.setExitCode(2);
    return;
  }

  const guard = ensureSpawnPrerequisites(ctx);
  if (!guard.ok) {
    ctx.printErr(`subagent spawn: ${guard.error}\n`);
    ctx.setExitCode(1);
    return;
  }

  const shareContext = parsed.flags['share-context'] === true;

  const result = await spawnSingleInternal(
    guard.manager,
    {
      profileId: ctx.profileId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
      tracer: ctx.tracer,
      eventSender: ctx.eventSender,
      callId: ctx.callId,
    },
    {
      subAgentName: name,
      task,
      shareContext,
    },
  );

  // `--json` 是 forward-compat:本命令 default output 已是 JSON envelope
  // (renderer view 解析需要),所以 flag 命中与否输出形态相同。
  void isJson(parsed.flags);

  ctx.print(result.content + '\n');
  if (!result.ok) {
    ctx.setExitCode(1);
  }
}
