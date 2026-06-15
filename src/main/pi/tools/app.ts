/**
 * `app` LocalTool —— "应用内能力" 的统一 shell 入口。
 *
 * LLM 视角下,Deskmate 的所有应用能力(MCP 管理、agent 管理、schedule、
 * web 搜索 ...)都通过这一个工具调用。args 是一行 shell-style 字符串,
 * 宿主解析、路由到具体 `AppCommand` 执行。
 *
 * **为什么是单工具 + 字符串 cmdline,不是 N 个 typed 工具**:
 *   - LLM 已经被训练过 shell 范式(npm/git/docker/kubectl 千万次曝光),
 *     传字符串 cmdline 激活的是它最强的那部分能力。
 *   - 工具列表行数 = O(1),与应用能力数无关,prompt cache 命中率高。
 *   - 渐进披露由 `<cmd> --help` 自然完成,无须 LLM 学习新协议。
 *
 * 设计文档:[`ai.prompt/tool-system.md`](../../../../ai.prompt/tool-system.md)
 */

import { dispatchAppCommand, formatAppCmdContent, buildTopLevelHelp } from '../appcmd/dispatcher';
import { parseCmdline } from '../appcmd/parseCmdline';
import { appCommands } from '../appcmd/registry';

import { jsonSchema } from './schema';
import type { LocalTool, ToolResult } from './types';

interface AppToolArgs {
  cmd: string;
}

const PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    cmd: {
      type: 'string',
      description:
        'Shell-style command line invoking an in-app capability. ' +
        'Run "<command> --help" to see usage, "app --help" or just "app" to list commands. ' +
        'Add --json for structured output when supported, --dry-run to preview destructive ops, ' +
        '--yes/-y to confirm destructive ops. ' +
        'Example: app("mcp install brave-search --env BRAVE_KEY=xxx")',
    },
  },
  required: ['cmd'],
});

/**
 * 描述字符串里**内嵌**全部命令的 synopsis —— 这是渐进披露的"索引"。
 * LLM 永远看得到完整命令列表(成本随命令数线性,每条 ~40 字符),想知道
 * 详细用法就调 `app("<name> --help")`。
 *
 * 取值时机:每次 LLM streamSimple 重建 catalog 时本工具的 spec.description
 * 会被取一次。`appCommands.list()` 是 O(N) + sort,N 是注册命令数(预计
 * 个位数到十几),开销可忽略。**不**缓存的原因:dev hot-reload / 测试隔离
 * 期会重新注册,缓存反而可能让"刚注册的命令"在描述里缺席。
 */
function buildDescription(): string {
  const cmds = appCommands.list();
  if (cmds.length === 0) {
    return (
      'Run an in-app command using a shell-style cmdline. ' +
      'No commands are currently registered. ' +
      'Run "app --help" anyway to see the welcome text.'
    );
  }
  const maxName = Math.max(...cmds.map((c) => c.name.length));
  const indexLines = cmds.map((c) => `  ${c.name.padEnd(maxName)}  ${c.synopsis}`);
  return (
    'Run an in-app command using a shell-style cmdline.\n' +
    '\n' +
    'Available commands:\n' +
    indexLines.join('\n') +
    '\n\n' +
    'Run "<command> --help" for detailed usage. Run "app --help" or call with empty cmdline to re-list commands. ' +
    'Add --json for structured output when supported. Add --dry-run / --yes for destructive operations.'
  );
}

export const app: LocalTool = {
  spec: {
    name: 'app',
    /**
     * description 是一个 getter 风格 —— pi-ai 在 streamSimple 时读 spec
     * 取值,所以这里写成 IIFE 等价 const,**模块加载后第一次 list 工具时**
     * 就会冻结。命令注册顺序由 `appcmd/index.ts` 与本文件的 import 顺序
     * 一起决定:`pi/tools/index.ts` 先 `import './app'`(就近 import 触发
     * registry 构造),再走批 F 的命令注册(它们副作用 `register(...)` 到
     * appCommands)。所以**实际取 description 时**(register 完成后第一次
     * pi.streamSimple),命令已经全在册。
     *
     * 不动 description 形态(不要改成 function)的原因:pi-ai `Tool` 类型
     * 要求 `description: string`,改了就不合 spec。
     */
    get description() {
      return buildDescription();
    },
    parameters: PARAMETERS,
  },
  async handler(args, ctx): Promise<ToolResult> {
    const { cmd: cmdline } = args as AppToolArgs;

    // 顶层入口"松散"设计 —— LLM 一时找不到正确形态时,我们**不**惩罚它,
    // 而是把顶层 help 端到它面前,让它立刻知道有哪些路可走。下列三种情况
    // 一律降级到 help:
    //   1. cmdline 完全空 / `--help` / `-h`
    //   2. cmdline 语法错(未闭合引号、孤立反斜杠等)
    //   3. 第一个 token 不匹配任何已注册命令
    //
    // 设计意图:顶层 = "教 LLM 怎么用",不是"严格守门"。一旦 LLM 走进
    // 具体命令域(`hello bogus-sub` 这种),错误反馈就该具体精确,所以
    // 子命令拼错仍然是 `(exit 2)` —— 那由对应 AppCommand 内部决定,顶层
    // 不干预。
    //
    // 语法错 / 未知命令时**不**附 `(exit N)` —— 顶层 help 视角下 LLM 看到
    // 的就是"我得到了帮助",零负面信号,降低重试摩擦。宿主想观察"LLM
    // 偏离了多少"可以在 tracer 里 emit,不污染 LLM 上下文。

    const parsed = parseCmdline(cmdline);
    if (!parsed.ok) {
      return {
        ok: true,
        content: `${buildTopLevelHelp()}\ntip: cmdline parse error: ${parsed.error} — see USAGE above.\n`,
      };
    }
    const argv = parsed.argv;

    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
      return { ok: true, content: buildTopLevelHelp() };
    }

    const [name, ...rest] = argv;
    const cmd = appCommands.get(name);
    if (!cmd) {
      return {
        ok: true,
        content: `${buildTopLevelHelp()}\ntip: no command named "${name}" — pick one from the list above.\n`,
      };
    }

    const result = await dispatchAppCommand(cmd, rest, ctx);
    return { ok: true, content: formatAppCmdContent(result) };
  },
};
