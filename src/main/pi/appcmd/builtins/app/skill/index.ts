/**
 * `skill` AppCommand —— 管理 skill 的安装 / 卸载 / 绑定 / 解绑 / 列表 /
 * 状态 / 搜索。
 *
 * 设计完全对标 `mcp/` / `agent/` —— 同样的 subcommand 命名学,只是把
 * "skill 的特殊语义"(install vs bind 显式分离)落到具体 subcommand。
 *
 * 文件布局范式(详见 `ai.prompt/tool-system.md` §6):
 *   index.ts        本文件 —— 只做 HELP_TOP / switch / AppCommand object
 *   _shared.ts      跨 subcommand 共享的纯函数 helper(name 校验 + agent 解析)
 *   install.ts      `skill install <name> --path <p>`(仅 device-path)
 *   uninstall.ts    `skill uninstall <name>... --yes`         (destructive)
 *   bind.ts         `skill bind <skill-name>`                  (默认 → current agent)
 *   unbind.ts       `skill unbind <skill-name>...`             (默认 → current agent)
 *   list.ts         `skill list`                                (read-only)
 *   status.ts       `skill status <name> [--json]`              (read-only)
 *   search.ts       `skill search <query>`                      (仅本地 installed,要求 query)
 *   kernel/         business internal *Internal() functions(7 个文件)
 */

import type { AppCommand } from '../../../types';

import { runBind } from './bind';
import { runInstall } from './install';
import { runList } from './list';
import { runSearch } from './search';
import { runStatus } from './status';
import { runUnbind } from './unbind';
import { runUninstall } from './uninstall';

const HELP_TOP = `USAGE
  skill <subcommand> [options]

DESCRIPTION
  Manage skills — install from a local device path, bind to agents,
  list / inspect status, search installed skills. Mirrors the shell idioms of
  npm, apt, docker. install / bind are intentionally separate (like apt
  install vs systemctl enable).

SUBCOMMANDS
  install <name>      Install a skill to the device. Requires --path.
  uninstall <name>... Remove installed skill(s) from the device. Requires --yes.
  bind <skill>        Attach an installed skill to one or more agents.
  unbind <skill>...   Detach skill(s) from agent configurations.
  list                List all installed skills.
  status <name>       Show the status of a skill (NotInstalled / Installed + details).
  search <query>      Search installed skills.

GLOBAL OPTIONS (recognised by every subcommand)
  --help, -h     Show subcommand help.
  --json         Output structured JSON where supported.
  --dry-run      Show what would happen without performing destructive ops.
                 Supported by: install, uninstall, bind, unbind.
  --yes, -y      Confirm a destructive op. REQUIRED by: uninstall.

EXAMPLES
  skill install pptx --path /path/to/pptx.zip
  skill bind pptx
  skill bind pptx --agent-name "Deck Builder"
  skill unbind pptx --all-agents
  skill list
  skill status pptx
  skill search pdf
  skill search "office docs" --json
  skill uninstall my-tool --yes
`;

export const skillCommand: AppCommand = {
  name: 'skill',
  synopsis: 'Manage skills: install/uninstall/bind/unbind/list/status/search.',
  help: HELP_TOP,

  async run(argv, ctx) {
    const [sub, ...rest] = argv;

    if (sub === undefined || sub === '--help' || sub === '-h') {
      ctx.print(HELP_TOP);
      return;
    }

    switch (sub) {
      case 'install':
        await runInstall(rest, ctx);
        return;
      case 'uninstall':
        await runUninstall(rest, ctx);
        return;
      case 'bind':
        await runBind(rest, ctx);
        return;
      case 'unbind':
        await runUnbind(rest, ctx);
        return;
      case 'list':
        await runList(rest, ctx);
        return;
      case 'status':
        await runStatus(rest, ctx);
        return;
      case 'search':
        await runSearch(rest, ctx);
        return;
      default:
        ctx.printErr(`skill: unknown subcommand "${sub}". Try "skill --help".\n`);
        ctx.setExitCode(2);
    }
  },
};
