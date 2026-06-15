/**
 * `mcp` AppCommand —— 管理 MCP server 的添加 / 更新 / 删除 / 连接态 / 状态。
 *
 * 文件布局范式(详见 `ai.prompt/tool-system.md` §6):
 *   index.ts        本文件 —— 只做 HELP_TOP / switch / AppCommand object
 *   _shared.ts      跨 subcommand 共享的纯函数 helper
 *   add.ts          `mcp add <name> --transport ...`         (custom)
 *   update.ts       `mcp update <name> [partial flags]`
 *   remove.ts       `mcp remove <name> --yes`                (destructive)
 *   connection.ts   `mcp connect|disconnect|reconnect <name>` (idempotent)
 *   status.ts       `mcp status <name> [--json]`             (read-only)
 */

import type { AppCommand } from '../../types';

import { runAdd } from './add';
import { runConnect, runDisconnect, runReconnect } from './connection';
import { runRemove } from './remove';
import { runStatus } from './status';
import { runUpdate } from './update';

const HELP_TOP = `USAGE
  mcp <subcommand> [options]

DESCRIPTION
  Manage MCP servers — add custom servers, toggle connections, inspect
  status. Mirrors the shell idioms of npm, apt, docker.

SUBCOMMANDS
  add <name>         Add a custom server (need --transport ...).
  update <name>      Update fields of an installed server (partial patch).
  remove <name>      Remove an installed server. Requires --yes (destructive).
  connect <name>     Start the connection (idempotent).
  disconnect <name>  Stop the connection but keep config (idempotent).
  reconnect <name>   Disconnect then connect again.
  status <name>      Show the runtime status of a server.

GLOBAL OPTIONS (recognised by every subcommand)
  --help, -h     Show subcommand help.
  --json         Output structured JSON where supported.
  --dry-run      Show what would happen without performing destructive ops.
                 Supported by: add, remove.
  --yes, -y      Confirm a destructive op. REQUIRED by: remove.

EXAMPLES
  mcp add my-stdio --transport stdio --command npx --arg -y --arg my-pkg
  mcp update brave-search --env BRAVE_API_KEY=new-key
  mcp status brave-search
  mcp reconnect brave-search
  mcp remove brave-search --yes
`;

export const mcpCommand: AppCommand = {
  name: 'mcp',
  synopsis: 'Manage MCP servers: add/update/remove/connect/disconnect/reconnect/status.',
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
      case 'connect':
        await runConnect(rest, ctx);
        return;
      case 'disconnect':
        await runDisconnect(rest, ctx);
        return;
      case 'reconnect':
        await runReconnect(rest, ctx);
        return;
      case 'status':
        await runStatus(rest, ctx);
        return;
      default:
        ctx.printErr(`mcp: unknown subcommand "${sub}". Try "mcp --help".\n`);
        ctx.setExitCode(2);
    }
  },
};
