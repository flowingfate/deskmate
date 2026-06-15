/**
 * `subagent` AppCommand —— 按 name 派生已注册的 sub-agent,单 task / 并行批。
 *
 * 文件布局范式(详见 `ai.prompt/tool-system.md` §6):
 *   index.ts        本文件 —— HELP_TOP + switch 路由 + AppCommand object
 *   _shared.ts      ensureSpawnPrerequisites + cmdline parser helpers
 *   spawn.ts        `subagent spawn <name> <task>`             (1 task)
 *   spawn-many.ts   `subagent spawn-many --task ... | --config-json ...`
 *                   (N parallel, MAX_PARALLEL_TASKS 截断)
 *   kernel/spawn.ts       业务内核:1-task SubAgentManager 调用
 *   kernel/spawnMany.ts   业务内核:N-task allSettled 包装
 *
 * 设计纪律:
 *   - **action-style op**(`spawn` / `spawn-many`)与 `mcp connect` 同类:
 *     有副作用但不破坏,**不**要求 `--yes`。
 *   - 输出默认 JSON envelope —— `SubAgentToolCallView` /
 *     `ParallelSubAgentsToolCallView` 解析的就是这个;`--json` flag 走 forward-
 *     compat 但不改变输出形态。
 *   - 递归保护(`isSubAgent` 拦截)在每个 subcommand 里 `ensureSpawnPrerequisites`
 *     做,**不**依赖 toolCatalog 二次过滤 —— `app` 工具本身不能从 sub-agent
 *     catalog 移除(那等于禁掉所有应用能力),所以保护必须下沉到命令内部。
 */
import type { AppCommand } from '../../types';

import { runSpawn } from './spawn';
import { runSpawnMany } from './spawn-many';

const HELP_TOP = `USAGE
  subagent <subcommand> [options]

DESCRIPTION
  Delegate a task to one or more registered sub-agents. Sub-agents run
  independently and return structured results when done. See "list of
  available sub-agents" in the system prompt section.

SUBCOMMANDS
  spawn <name> <task>        Hand <task> to a single sub-agent <name>.
                             Quote multi-word task strings.
  spawn-many --task ... | --config-json ...
                             Run several sub-agents in parallel. Use
                             --config-json for per-task shareContext.

GLOBAL OPTIONS (recognised by every subcommand)
  --help, -h         Show subcommand help.
  --share-context    Pass the parent context summary to the sub-agent(s);
                     ignored for sub-agents with context_access="isolated".
  --json             Forward-compat; both subcommands already emit JSON
                     envelopes consumed by renderer views.

NOTES
  * Sub-agents cannot spawn other sub-agents (recursion is rejected at
    exit 1). The recursion guard is enforced inside this command, not by
    the global tool catalog.
  * Parallel spawn-many is capped at MAX_PARALLEL_TASKS (server-side);
    extra tasks are silently truncated. Spawn fewer than that per call.

EXAMPLES
  subagent spawn researcher "Find papers on diffusion LLMs."
  subagent spawn coder "Refactor login flow." --share-context

  subagent spawn-many \\
    --task "researcher:Read paper X" \\
    --task "coder:Sketch the API"

  subagent spawn-many --config-json '[
    { "name":"writer",   "task":"Draft notes",  "shareContext":false },
    { "name":"reviewer", "task":"Critique it",  "shareContext":true  }
  ]'
`;

export const subagentCommand: AppCommand = {
  name: 'subagent',
  synopsis: 'Spawn registered sub-agents (single or parallel) to handle delegated tasks.',
  help: HELP_TOP,

  async run(argv, ctx) {
    const [sub, ...rest] = argv;

    if (sub === undefined || sub === '--help' || sub === '-h') {
      ctx.print(HELP_TOP);
      return;
    }

    switch (sub) {
      case 'spawn':
        await runSpawn(rest, ctx);
        return;
      case 'spawn-many':
        await runSpawnMany(rest, ctx);
        return;
      default:
        ctx.printErr(`subagent: unknown subcommand "${sub}". Try "subagent --help".\n`);
        ctx.setExitCode(2);
    }
  },
};
