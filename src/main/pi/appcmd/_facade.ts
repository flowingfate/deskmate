/**
 * 「命令 facade」工厂 —— 把一个 `AppCommand` 包成顶层 LocalTool。
 *
 * **`app` 与 `web` 走的是完全对等的这一条路径**,两者都是
 * `makeCommandFacade(makeRouterCommand({ name, synopsis, registry }))`:
 *   - `app`:registry = 全局 `appCommands`(成员 mcp / agent / skill / ...)
 *   - `web`:registry = `webCommands`(成员 search / image / fetch / download)
 * 路由 / help / 描述索引的逻辑全在 `makeRouterCommand` 一份里,差异仅在注册表
 * 装了谁。facade 这一层对两者一视同仁:parseCmdline → dispatchAppCommand →
 * formatAppCmdContent,外加 stdio buffer / exit code / `--help` / `--json` 语义共享。
 *
 * facade 本身**不**假定绑定的是 router —— 它只要求一个 `AppCommand`。`spec.description`
 * 优先取 `cmd.toolDescription()`(router 用来内嵌命令索引),缺省时用 `synopsis`
 * 合成,因此理论上也能包一个 leaf 命令(目前顶层只有两个 router)。
 *
 * 设计文档:[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
 */

import { dispatchAppCommand, formatAppCmdContent } from './dispatcher';
import { parseCmdline } from './parseCmdline';
import type { AppCommand } from './types';

import { jsonSchema } from '../tools/schema';
import type { LocalTool, ToolResult } from '../tools/types';

interface FacadeToolArgs {
  cmd: string;
}

/**
 * facade 的参数 schema —— 单个 `cmd` 字符串,router/leaf 通用。措辞刻意中性
 * (「first token」既可能是 router 的命令名,也可能是 leaf 的 subcommand),
 * 具体「有哪些」由 `spec.description`(见 `toolDescription`)或 `<cmd> --help` 披露。
 */
function buildParameters(cmd: AppCommand) {
  return jsonSchema({
    type: 'object',
    properties: {
      cmd: {
        type: 'string',
        description:
          `Shell-style command line for the "${cmd.name}" tool. ` +
          `Run "--help", or call with empty cmdline, to see usage and the available first-token list. ` +
          'Add --json for structured output when supported, --dry-run / --yes for destructive ops. ' +
          `Example: ${cmd.name}("...")`,
      },
    },
    required: ['cmd'],
  });
}

/**
 * 把单个 `AppCommand` 包成一个普通 LocalTool。
 *
 * - `spec.name` = `cmd.name`(LLM 看到 `app` / `web` 作为顶层工具)。
 * - `spec.description` 用 getter 实时取值,与 dev hot-reload / 测试隔离同纪律
 *   (绝不缓存陈旧值):命令提供 `toolDescription()` 就用它(router 用来内嵌
 *   命令索引),否则用 `synopsis` 合成一段简短默认描述(leaf 的常态)。
 * - handler:cmdline → parseCmdline → dispatchAppCommand(cmd, argv) → format。
 *   空 cmdline / `--help` / `-h` / 路由失败**不**在这里特判 —— 透传给 `cmd.run`,
 *   由命令自身决定(router 打印顶层 help,leaf 打印自己的 help)。
 */
export function makeCommandFacade(cmd: AppCommand): LocalTool {
  const parameters = buildParameters(cmd);
  return {
    spec: {
      name: cmd.name,
      get description() {
        if (cmd.toolDescription) return cmd.toolDescription();
        return (
          `${cmd.synopsis}\n\n` +
          `Run a "${cmd.name}" subcommand using a shell-style cmdline. ` +
          `Run "--help" or call with empty cmdline for the full subcommand list and usage.`
        );
      },
      parameters,
    },
    async handler(args, ctx): Promise<ToolResult> {
      const { cmd: cmdline } = args as FacadeToolArgs;

      const parsed = parseCmdline(cmdline);
      if (!parsed.ok) {
        // 语法错时降级到命令自身的 help + 温和 tip,与 `app` 顶层「松散」纪律
        // 对齐:不附 exit code,零负面信号,降低 LLM 重试摩擦。
        return {
          ok: true,
          content: `${cmd.help}\ntip: cmdline parse error: ${parsed.error} — see USAGE above.\n`,
        };
      }

      const result = await dispatchAppCommand(cmd, parsed.argv, ctx);
      const content = formatAppCmdContent(result);
      return result.deliverables.length > 0
        ? { ok: true, content, deliverables: result.deliverables }
        : { ok: true, content };
    },
  };
}
