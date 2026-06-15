/**
 * `parseCmdline` —— `app` 工具的 cmdline 词法分析层。
 *
 * 角色:把 LLM 写的一行 shell-style 字符串切成 argv。**只**做 quoting /
 * escape;不做任何 shell expansion(`$VAR` / `$(...)` / `~` / glob / pipe
 * / redirect)。LLM 在 `app(...)` 里写 `|` / `>` / `$(pwd)` 一律按字面
 * token 出来,由具体 AppCommand 自己决定怎么 react —— 我们绝不假装支持
 * pipe / 命令替换。
 *
 * 实现:thin wrapper over vendored `args-tokenizer`(见
 * `./vendor/argsTokenizer.ts` 模块头注解释 vendor 而非 npm 装的原因 +
 * 我们做的 POSIX 单引号差异修正)。本文件只负责:
 *   1. envelope 形态(`ParseCmdlineResult`),让 caller 不用包 try/catch
 *   2. 把 vendored 函数的 throw 收敛成 `{ ok: false, error }`
 *   3. 在错误信息里**不**追加 stack —— LLM 看到的就是一句人话
 *
 * 顶层 caller(`tools/app.ts`)在 `ok: false` 时会降级到顶层 help + tip,
 * 见 app.ts 的"松散顶层"注释。
 */

import { tokenizeArgs } from './vendor/argsTokenizer';

export interface ParseCmdlineOk {
  readonly ok: true;
  readonly argv: string[];
}

export interface ParseCmdlineErr {
  readonly ok: false;
  readonly error: string;
}

export type ParseCmdlineResult = ParseCmdlineOk | ParseCmdlineErr;

/**
 * 切 cmdline 成 argv。
 *
 * - 空串 / 纯空白 → `{ ok: true, argv: [] }`,由 caller 决定怎么处理"空命令"
 *   (`app.ts` 里返回顶层 help)。
 * - 未闭合引号 → `{ ok: false, error }`,vendored tokenizer throw,本函数
 *   收敛。
 * - 孤立尾反斜杠(引号外) → 静默吞掉(与 vendored 上游一致)。我们**有意**
 *   不在 wrapper 里把它升级成 error —— 顶层已经松散兜底,这种边界 case
 *   即使被吃掉,LLM 看到的最坏结果也是 argv 少一个字符。保留一处与上游
 *   零偏差,降低 vendored 文件的维护负担。
 */
export function parseCmdline(cmdline: string): ParseCmdlineResult {
  try {
    // strict 模式(无 `{ loose: true }`):让未闭合引号 throw,而不是静默
    // 吞 —— 顶层 app.ts 会捕到这个错并降级到 help + tip,LLM 体感是"我
    // 被引导回正路",不是"我成功了但 argv 莫名其妙"。
    const argv = tokenizeArgs(cmdline);
    return { ok: true, argv };
  } catch (err) {
    // vendored 只 throw `Error("Unexpected end of string. Closing quote is missing.")`
    // 一种;非 Error 不可能从那条路径出来。但保守起见仍兜底。
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
