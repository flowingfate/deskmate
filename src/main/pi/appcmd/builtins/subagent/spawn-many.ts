/**
 * `subagent spawn-many --task "name:task" [--task ...] [--share-context]`
 * `subagent spawn-many --config-json '<JSON array>' [--json]`
 *
 * 并行派生多个 sub-agent。两种参数来源 **互斥**:
 *   1. 简洁形态 `--task "<name>:<task description>"` 可重复,适合同质 task
 *      list(全部 task 共享 cmdline-level `--share-context` 设置)。
 *   2. 完整形态 `--config-json '[{ "name":..., "task":..., "shareContext":... }]'`
 *      —— per-task 独立 shareContext,escape hatch(`tool-system.md §9.5`
 *      `--config-json` 纪律)。
 *
 * 失败语义:`MAX_PARALLEL_TASKS` 截断不报错(只截断,LLM 一次性投太多自己
 * 调整);全部 task 成功 → exit 0,任一 task 失败 → exit 1,但 envelope
 * 仍带回所有 task 的 markdown 详细结果。
 */
import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { spawnManyInternal, type SpawnManyTask } from './kernel/spawnMany';
import {
  ensureSpawnPrerequisites,
  parseConfigJsonFlag,
  parseTaskFlag,
} from './_shared';

const HELP = `USAGE
  subagent spawn-many --task <entry> [--task <entry> ...] [options]
  subagent spawn-many --config-json '<JSON array>' [options]

DESCRIPTION
  Spawn several registered sub-agents in parallel. Use the simple form for
  homogeneous batches; switch to --config-json when per-task shareContext
  differs.

OPTIONS
  --task <entry>     Repeatable. Entry format: "<name>:<task description>".
                     The first ":" is the separator; the rest is the task.
                     Mutually exclusive with --config-json.
  --config-json <s>  JSON array escape hatch. Each element:
                       { "name": string, "task": string, "shareContext"?: boolean }
                     Mutually exclusive with --task.
  --share-context    Applied to every --task entry when set. Per-task
                     overrides only via --config-json.
  --json             Forward-compat; output is already a JSON envelope.
  --help, -h         Show this help.

EXAMPLES
  subagent spawn-many \\
    --task "researcher:Read paper X and summarise" \\
    --task "coder:Sketch the API surface"

  subagent spawn-many --share-context \\
    --task "writer:Draft a release note for v3.0" \\
    --task "reviewer:Critique the draft"

  subagent spawn-many --config-json '[
    { "name":"researcher", "task":"Read paper X", "shareContext":false },
    { "name":"coder",      "task":"Sketch API",   "shareContext":true  }
  ]'
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'task', type: 'array' },
  { name: 'config-json', type: 'string' },
  { name: 'share-context', type: 'boolean' },
];

export async function runSpawnMany(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`subagent spawn-many: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length > 0) {
    ctx.printErr(
      `subagent spawn-many: unexpected positional args ` +
        `(${parsed.positional.length}); use --task / --config-json instead.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const hasTask = parsed.flags.task !== undefined;
  const hasConfigJson = parsed.flags['config-json'] !== undefined;

  if (hasTask && hasConfigJson) {
    ctx.printErr(
      'subagent spawn-many: --task and --config-json are mutually exclusive.\n',
    );
    ctx.setExitCode(2);
    return;
  }
  if (!hasTask && !hasConfigJson) {
    ctx.printErr(
      'subagent spawn-many: provide --task (repeatable) or --config-json.\n' +
        'Try "subagent spawn-many --help".\n',
    );
    ctx.setExitCode(2);
    return;
  }

  // 解析 task list。两条来源走完全不同的 parser,但合并到同一 SpawnManyTask[]
  // 形态喂给 kernel —— kernel 不关心来源,只关心最终的三元组。
  const shareDefault = parsed.flags['share-context'] === true;
  let tasks: SpawnManyTask[];

  if (hasConfigJson) {
    const r = parseConfigJsonFlag(parsed.flags['config-json']);
    if (!r.ok) {
      ctx.printErr(`subagent spawn-many: ${r.error}\n`);
      ctx.setExitCode(2);
      return;
    }
    tasks = r.tasks.map((t) => ({
      subAgentName: t.name,
      task: t.task,
      shareContext: t.shareContext,
    }));
  } else {
    const r = parseTaskFlag(parsed.flags.task);
    if (!r.ok) {
      ctx.printErr(`subagent spawn-many: ${r.error}\n`);
      ctx.setExitCode(2);
      return;
    }
    tasks = r.tasks.map((t) => ({
      subAgentName: t.name,
      task: t.task,
      shareContext: shareDefault,
    }));
  }

  if (tasks.length === 0) {
    ctx.printErr('subagent spawn-many: no tasks resolved from arguments.\n');
    ctx.setExitCode(2);
    return;
  }

  const guard = ensureSpawnPrerequisites(ctx);
  if (!guard.ok) {
    ctx.printErr(`subagent spawn-many: ${guard.error}\n`);
    ctx.setExitCode(1);
    return;
  }

  const result = await spawnManyInternal(
    guard.manager,
    {
      profileId: ctx.profileId,
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
      tracer: ctx.tracer,
      eventSender: ctx.eventSender,
      callId: ctx.callId,
      getSubAgentConfig: ctx.getSubAgentConfig!,
    },
    { tasks },
  );

  void isJson(parsed.flags);

  ctx.print(result.content + '\n');
  if (!result.ok) {
    ctx.setExitCode(1);
  }
}
