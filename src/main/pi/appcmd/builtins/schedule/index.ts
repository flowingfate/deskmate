/**
 * `schedule` AppCommand —— 管理 scheduler job 的 CRUD + 手动触发。
 *
 * 5 个 subcommand:create / list / update / remove / run
 *   - create / update / list / remove:CRUD 范式,与 mcp/agent/skill 对齐
 *   - run:显式 action(`kubectl run` / `systemctl start` 范式)
 *
 * 老 LocalTool 时代只有 create / get / update / run 四件套 —— 缺 `remove`
 * 是历史遗漏(`schedulerManager.deleteJob` 早就有,但只 renderer IPC 用,
 * LLM 没法删)。本批一次到位补齐能力面。
 *
 * 文件布局范式(详见 `ai.prompt/tool-system.md` §6):
 *   index.ts     本文件 —— 只做 HELP_TOP / switch / AppCommand object
 *   _shared.ts   跨 subcommand 的小 helper(validateJobId / parseEnabledFlag /
 *                parseScheduleTypeFlag / formatJobLine)
 *   create.ts    `schedule create <name> --message ... (--cron|--at) ...`
 *   list.ts      `schedule list [--agent <id>] [--json]`
 *   update.ts    `schedule update <job-id> [partial flags]`
 *   remove.ts    `schedule remove <job-id> --yes`              (destructive)
 *   run.ts       `schedule run <job-id>`                       (action)
 *
 * Feature flag:`schedule` AppCommand 由 `deskmateFeatureScheduler` 守卫
 * 在 `appcmd/index.ts` 决定是否 `register` —— 与老 `pi/tools/index.ts`
 * 注册 schedule LocalTool 同模式。
 */

import type { AppCommand } from '../../types';

import { runCreate } from './create';
import { runList } from './list';
import { runRemove } from './remove';
import { runRun } from './run';
import { runUpdate } from './update';

const HELP_TOP = `USAGE
  schedule <subcommand> [options]

DESCRIPTION
  Manage scheduled tasks. When a schedule fires, a NEW chat session is
  started under the target agent and the message you registered is sent
  as the first user prompt.

SUBCOMMANDS
  create <name>     Register a schedule (--cron or --at, --message required).
  list              List registered schedules (optionally --agent <id>).
  update <job-id>   Edit fields of an existing schedule (partial).
  remove <job-id>   Remove a schedule. Requires --yes (destructive).
  run <job-id>      Trigger a schedule immediately.

GLOBAL OPTIONS (recognised by every subcommand)
  --help, -h     Show subcommand help.
  --json         Output structured JSON (create/list/update/remove/run).
  --dry-run      Show what would happen without performing the op.
                 Supported by: create, update, remove.
  --yes, -y      Confirm a destructive op. REQUIRED by: remove.

EXAMPLES
  schedule create "morning digest" --cron "0 6 * * *" --message "Summarize unread emails."
  schedule create "remind me" --at "2026-03-10T08:00:00+08:00" --message "Time to rest."
  schedule list
  schedule list --agent a_abc --json
  schedule update j_abc --message "Send a brief weekly digest"
  schedule update j_abc --enabled false
  schedule run j_abc
  schedule remove j_abc --yes
`;

export const scheduleCommand: AppCommand = {
  name: 'schedule',
  synopsis: 'Manage scheduled tasks: create/list/update/remove/run.',
  help: HELP_TOP,

  async run(argv, ctx) {
    const [sub, ...rest] = argv;

    if (sub === undefined || sub === '--help' || sub === '-h') {
      ctx.print(HELP_TOP);
      return;
    }

    switch (sub) {
      case 'create':
        await runCreate(rest, ctx);
        return;
      case 'list':
        await runList(rest, ctx);
        return;
      case 'update':
        await runUpdate(rest, ctx);
        return;
      case 'remove':
        await runRemove(rest, ctx);
        return;
      case 'run':
        await runRun(rest, ctx);
        return;
      default:
        ctx.printErr(`schedule: unknown subcommand "${sub}". Try "schedule --help".\n`);
        ctx.setExitCode(2);
    }
  },
};
