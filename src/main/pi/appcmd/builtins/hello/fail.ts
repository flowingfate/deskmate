/**
 * `hello fail` —— 故意"业务失败"路径,演示 exit !=0 + stderr 的语义。
 *
 * 不解析 flag,不读 argv —— 是最简形态的 subcommand 模板。
 */

import type { AppCmdContext } from '../../types';

export function runFail(_argv: string[], ctx: AppCmdContext): void {
  ctx.printErr('hello fail: this command always fails by design.\n');
  ctx.setExitCode(42);
}
