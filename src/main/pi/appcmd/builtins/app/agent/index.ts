/**
 * `agent` AppCommand —— 管理 agent 的添加 / 更新 / 删除 / 状态 / 列表 /
 * primary 切换。
 *
 * 文件布局范式(详见 `ai.prompt/tool-system.md` §6):
 *   index.ts        本文件 —— 只做 HELP_TOP / switch / AppCommand object
 *   _shared.ts      跨 subcommand 共享的纯函数 helper(name validate / flag parser)
 *   add.ts          `agent add <name> [config]`           (custom)
 *   update.ts       `agent update <name> [partial flags]`
 *   remove.ts       `agent remove <name> --yes`           (destructive)
 *   list.ts         `agent list`                          (read-only)
 *   status.ts       `agent status <name> [--json]`        (read-only)
 *   set-primary.ts  `agent set-primary <name>`
 *   kernel/         business internal *Internal() functions
 */

import type { AppCommand } from '../../../types';

import { runAdd } from './add';
import { runList } from './list';
import { runRemove } from './remove';
import { runSetPrimary } from './set-primary';
import { runStatus } from './status';
import { runUpdate } from './update';

const HELP_TOP = `USAGE
  agent <subcommand> [options]

DESCRIPTION
  Manage agents — add custom agents, update fields, switch the primary
  agent, inspect status. Mirrors the shell idioms of npm, apt, docker.

SUBCOMMANDS
  add <name>          Add a custom agent.
  update <name>       Update fields of an installed agent (partial patch).
  remove <name>       Remove (archive) an installed agent. Requires --yes (destructive).
  list                List all installed agent names.
  status <name>       Show the status of an agent (NotAdded / Added + details).
  set-primary <name>  Set the primary agent for the owning profile.

GLOBAL OPTIONS (recognised by every subcommand)
  --help, -h     Show subcommand help.
  --json         Output structured JSON where supported.
  --dry-run      Show what would happen without performing destructive ops.
                 Supported by: add, remove.
  --yes, -y      Confirm a destructive op. REQUIRED by: remove.

EXAMPLES
  agent add my-bot --model gpt-4o-mini --system-prompt "Be concise."
  agent update my-bot --model gpt-4o
  agent status my-bot
  agent set-primary my-bot
  agent remove my-bot --yes
`;

export const agentCommand: AppCommand = {
  name: 'agent',
  synopsis: 'Manage agents: add/update/remove/list/status/set-primary.',
  help: HELP_TOP,

  async run(argv, ctx) {
    const [sub, ...rest] = argv;

    if (sub === undefined || sub === '--help' || sub === '-h') {
      ctx.print(HELP_TOP);
      return;
    }

    switch (sub) {
      case 'add':
        await runAdd(rest, ctx);
        return;
      case 'update':
        await runUpdate(rest, ctx);
        return;
      case 'remove':
        await runRemove(rest, ctx);
        return;
      case 'list':
        await runList(rest, ctx);
        return;
      case 'status':
        await runStatus(rest, ctx);
        return;
      case 'set-primary':
        await runSetPrimary(rest, ctx);
        return;
      default:
        ctx.printErr(`agent: unknown subcommand "${sub}". Try "agent --help".\n`);
        ctx.setExitCode(2);
    }
  },
};
