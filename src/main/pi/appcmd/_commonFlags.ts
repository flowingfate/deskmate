/**
 * 跨 AppCommand 共享的"通用 flag" specs。**任何命令实现**遇到这些语义
 * 必须直接 spread `COMMON_FLAGS`,绝不能各写一遍 —— UX 一致性是设计红线
 * (详见 `ai.prompt/tool-system.md` §4 "通用 flag 语义统一")。
 *
 * 共享语义清单(出现在哪个命令里都**完全一样**):
 *   - `--help` / `-h`        显示命令 help,exit 0,不执行任何业务
 *   - `--json`               输出结构化 JSON 而非人类可读文本(仅 read-like
 *                            命令需要;destructive 命令一般不消费)
 *   - `--dry-run`            演练:打印"将要发生什么",不执行副作用
 *   - `--yes` / `-y`         确认破坏性 op(`remove` / `uninstall` 等不带
 *                            `--yes` 一律 exit 1)
 *
 * 用法:
 *   ```ts
 *   import { COMMON_FLAGS, isHelp, isJson, isDryRun, isYes } from '../../_commonFlags';
 *
 *   const FLAGS: FlagSpec[] = [
 *     ...COMMON_FLAGS,
 *     { name: 'env', type: 'array' },   // 命令专属 flag 放后面
 *   ];
 *
 *   if (isHelp(parsed.flags)) { ctx.print(HELP); return; }
 *   ```
 *
 * `is*` helper 的存在意义:
 *   - 防止 caller 把 `parsed.flags.json` 当 boolean 用结果拿到 `string | true`;
 *   - 把"flag 命中 = `=== true`"这条约束集中在这里,后续若改 parseFlags 行为
 *     只需要改 helper 而不是 N 个 caller。
 */

import type { FlagSpec } from './flags';

/** 通用 flag spec 集合。所有 AppCommand subcommand 必须 spread 这个常量。 */
export const COMMON_FLAGS: readonly FlagSpec[] = [
  { name: 'help', alias: 'h', type: 'boolean' },
  { name: 'json', type: 'boolean' },
  { name: 'dry-run', type: 'boolean' },
  { name: 'yes', alias: 'y', type: 'boolean' },
];
/** flag 命中的判定:必须严格 `=== true`,排除 undefined / string。 */
type FlagMap = Readonly<Record<string, string | boolean | readonly string[] | undefined>>;

export function isHelp(flags: FlagMap): boolean {
  return flags.help === true;
}

export function isJson(flags: FlagMap): boolean {
  return flags.json === true;
}

export function isDryRun(flags: FlagMap): boolean {
  return flags['dry-run'] === true;
}

export function isYes(flags: FlagMap): boolean {
  return flags.yes === true;
}
