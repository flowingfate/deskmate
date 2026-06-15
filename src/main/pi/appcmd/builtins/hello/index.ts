/**
 * `hello` —— 骨架示范命令,**故意不调任何真实业务**。
 *
 * 存在目的:覆盖 AppCommand 契约的每一个角,作为后续真实命令的模板。
 *   - 多 subcommand:`hello say <name>` / `hello list` / `hello fail`
 *   - `--help` / `-h` 顶层和 subcommand 两级
 *   - `--json` 切换结构化输出
 *   - `--dry-run` / `--yes` 破坏性 op 双路
 *   - 数组型 flag(`--tag` 可重复)
 *   - 错误退出码:usage error → 2,业务失败 → 1,run 抛错 → dispatcher 兜底 1
 *   - `print` / `printErr` / `setExitCode` 三种 stdio helper
 *
 * 文件布局范式(详见 `ai.prompt/tool-system.md` §6 "AppCommand 文件布局"):
 *   一个 subcommand 一个文件(`say.ts` / `list.ts` / `fail.ts`),FLAGS / HELP /
 *   实现强内聚同文件;本 `index.ts` 只负责:
 *     1. 顶层 `HELP_TOP`(汇总信息)
 *     2. switch 路由 → 对应 subcommand 的 `runXxx`
 *     3. 导出 `AppCommand` object
 *
 * 后续实现真实命令(`mcp` / `agent` / `skill` / ...)时,**复制 `hello/`
 * 整个目录当模板**,subcommand 增减就增减文件,顶层 switch 一行一加即可。
 */

import type { AppCommand } from '../../types';

import { runSay } from './say';
import { runList } from './list';
import { runFail } from './fail';

const HELP_TOP = `USAGE
  hello <subcommand> [options]

DESCRIPTION
  Skeleton demo command. Showcases every AppCommand contract surface.
  Use this as a template when implementing real commands.

SUBCOMMANDS
  say <name>       Greet <name>. Optionally tag the greeting (repeatable).
  list             List all greetings recorded this session (here, always empty).
  fail             Always exits non-zero. Used to demonstrate error paths.

GLOBAL OPTIONS (recognised by every subcommand)
  --json           Emit JSON instead of human-readable text (where supported).
  --dry-run        Show what would happen without performing destructive ops.
  --yes, -y        Confirm a destructive op (required for "say --shout").
  --help, -h       Show this help.

EXAMPLES
  hello say world
  hello say world --tag formal --tag short
  hello say world --shout --yes
  hello say world --json
  hello list
  hello fail
`;

export const helloCommand: AppCommand = {
  name: 'hello',
  synopsis: 'Skeleton demo command. Use as a template when adding new commands.',
  help: HELP_TOP,

  async run(argv, ctx) {
    const [sub, ...rest] = argv;

    // 顶层 `hello` / `hello --help` / `hello -h` → 帮助
    if (sub === undefined || sub === '--help' || sub === '-h') {
      ctx.print(HELP_TOP);
      return;
    }

    switch (sub) {
      case 'say':
        runSay(rest, ctx);
        return;
      case 'list':
        runList(rest, ctx);
        return;
      case 'fail':
        runFail(rest, ctx);
        return;
      default:
        ctx.printErr(`hello: unknown subcommand "${sub}". Try "hello --help".\n`);
        ctx.setExitCode(2);
    }
  },
};
