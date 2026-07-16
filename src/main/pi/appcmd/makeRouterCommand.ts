/**
 * `makeRouterCommand` —— 把一个 `AppCommandRegistry` 包成「router 形态」的
 * `AppCommand`:cmdline 的**第一个 token 当作命令名**,从该注册表里查出对应
 * 成员命令并转交执行。
 *
 * 这是 `app` 与 `web` 完全对等的根：两个顶层 LocalTool 都显式持有
 * `makeRouterCommand({ name, synopsis, registry })` 的结果：
 *   - `app`: registry = 全局 `appCommands`(成员:mcp / agent / skill / ...)
 *   - `web`: registry = `webCommands`(成员:search / image / fetch / download)
 * 路由 / 顶层 help / 工具描述索引的逻辑只有这一份，差异仅在「注册表里装了谁」。
 *
 * 顶层入口「松散」纪律(与设计文档 §4 一致):空 cmdline / `--help` / `-h` /
 * 未知命令 一律降级到顶层 help,**不**附 exit code —— 顶层「教 LLM 怎么用」,
 * 不严格守门。成员命令**内部**的子参数 / flag 拼错仍由该成员自己严格 `(exit 2)`。
 *
 * router 自身**不**注册进它路由的那个 registry(它是 registry 的入口,不是成员)。
 *
 * 设计文档:[`ai.prompt/tool-system.md`](../../../ai.prompt/tool-system.md)
 */

import { isDelegatedExecution } from '@main/lib/delegateExecutionScope';
import type { AppCommandRegistry } from './registry';
import type { AppCommand, AppCmdContext } from './types';

interface RouterSpec {
  /** 顶层工具名,进 `spec.name` + help / 提示文案。 */
  readonly name: string;
  /** 一行能力概述,进 `synopsis`(facade 在缺 toolDescription 时也会用到)。 */
  readonly synopsis: string;
  /** 被路由的注册表。成员命令由各自的 builtins 模块填充。 */
  readonly registry: AppCommandRegistry;
  /** 可选的领域规则，追加到自动生成的命令表后。 */
  readonly helpFooter?: string;
}

const DELEGATED_WEB_BLOCKED_COMMANDS = new Set(['research']);

function visibleCommands(name: string, registry: AppCommandRegistry): AppCommand[] {
  const commands = registry.list();
  if (!isDelegatedExecution() || name !== 'web') return commands;
  return commands.filter((command) => !DELEGATED_WEB_BLOCKED_COMMANDS.has(command.name));
}

function rejectDelegatedCommand(name: string, argv: readonly string[], ctx: AppCmdContext): boolean {
  const [command] = argv;
  if (
    !isDelegatedExecution() ||
    name !== 'web' ||
    !command ||
    command === '--help' ||
    command === '-h' ||
    !DELEGATED_WEB_BLOCKED_COMMANDS.has(command)
  ) {
    return false;
  }
  ctx.printErr(`web ${command} requires user interaction and is unavailable in delegated runs.\n`);
  ctx.setExitCode(1);
  return true;
}

/**
 * 命令表 —— `  name  synopsis` 等宽对齐的一张表。
 *
 * **包进 ``` 代码围栏**:help/description 这两段最终都按 Markdown 渲染,比例
 * 字体下空格宽度 ≠ 字符均宽,`padEnd` 的「字符数对齐」会在视觉上列错位;围栏
 * 强制等宽,对齐才成立(顺带让喂给 LLM 的 description 也更易读)。
 */
function buildCommandTable(cmds: readonly AppCommand[]): string {
  const maxName = Math.max(...cmds.map((c) => c.name.length));
  const rows = cmds.map((c) => `  - ${c.name.padEnd(maxName)}  ${c.synopsis}`);
  return rows.join('\n');
}

/** 顶层 help —— `<name> --help` / 空 cmdline / 路由失败时统一应答。 */
function buildRegistryHelp(
  name: string,
  registry: AppCommandRegistry,
  helpFooter?: string,
): string {
  const cmds = visibleCommands(name, registry);
  if (cmds.length === 0) {
    return `${name}: no commands registered.\n`;
  }
  const lines = [
    `Run a "${name}" command. Available commands:`,
    '',
    buildCommandTable(cmds),
    '',
    `Run "${name} <command> --help" for detailed usage.`,
    'Add --json to any command for structured JSON output (if supported).',
  ];
  if (helpFooter) lines.push('', helpFooter);
  return lines.join('\n') + '\n';
}

/**
 * LLM 始终可见的工具描述 —— **内嵌**全部成员命令的 synopsis(渐进披露索引)。
 *
 * 取值时机:facade 的 `spec.description` getter 在每次重建 catalog 时调一次。
 * `registry.list()` 是 O(N) + sort(N 为成员数,个位数),开销可忽略。**不**缓存
 * —— dev hot-reload / 测试隔离期会重新注册,缓存可能让刚注册的命令缺席。
 */
function buildRegistryDescription(name: string, registry: AppCommandRegistry): string {
  const cmds = visibleCommands(name, registry);
  if (cmds.length === 0) {
    return (
      `Run a "${name}" command using a shell-style cmdline. ` +
      'No commands are currently registered. ' +
      `Run "${name} --help" anyway to see the welcome text.`
    );
  }
  return (
    `Run a "${name}" command using a shell-style cmdline.\n` +
    '\n' +
    'Available commands:\n' +
    buildCommandTable(cmds) +
    '\n\n' +
    `Run "${name} <command> --help" for detailed usage. Run "${name} --help" or call with empty cmdline to re-list commands. ` +
    'Add --json for structured output when supported. Add --dry-run / --yes for destructive operations.'
  );
}

export function makeRouterCommand(spec: RouterSpec): AppCommand {
  const { name, synopsis, registry, helpFooter } = spec;
  return {
    name,
    synopsis,
    // help / toolDescription 都动态枚举注册表 —— 永远反映「当前注册了谁」。
    get help() {
      return buildRegistryHelp(name, registry, helpFooter);
    },
    toolDescription() {
      return buildRegistryDescription(name, registry);
    },

    async run(argv: string[], ctx: AppCmdContext): Promise<void> {
      // 顶层「松散」:空 / --help / -h → 顶层 help,exit 0。
      if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        ctx.print(buildRegistryHelp(name, registry, helpFooter));
        return;
      }

      if (rejectDelegatedCommand(name, argv, ctx)) return;
      const [sub, ...rest] = argv;
      const cmd = registry.get(sub);
      if (!cmd) {
        // 未知命令仍走「松散兜底」:端 help + 温和 tip,不附 exit code,
        // 零负面信号、降低 LLM 重试摩擦。
        ctx.print(
          `${buildRegistryHelp(name, registry, helpFooter)}\ntip: no command named "${sub}" — pick one from the list above.\n`,
        );
        return;
      }

      // 转交成员命令,**复用同一个 AppCmdContext**(同一组 stdout/stderr
      // buffer + exit code),成员的输出与退出码自然冒泡到 facade 的合成层。
      await cmd.run(rest, ctx);
    },
  };
}
