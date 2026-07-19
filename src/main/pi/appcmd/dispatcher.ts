/**
 * AppCommand 调度器。`app.ts` 的 handler 拿到解析好的 argv 后,调
 * `dispatchAppCommand(cmd, argv, ctx)`,本模块:
 *   1. 构造一个带 stdout/stderr buffer 的 `AppCmdContext`
 *   2. 透传给 `cmd.run(argv, runCtx)`
 *   3. run 抛错 → 捕获、写 stderr、exit 1
 *   4. 合成最终 LLM 可见字符串:`<stdout>\n<stderr if any>\n(exit <code>)`
 *
 * 设计:dispatcher **完全不解析 argv**(那是 AppCommand 自己的事)。
 * 它只负责"提供 stdio buffer + 把 run 的输出包成 LLM 看得到的形态"
 * —— 与 `process` 给 CLI 进程提供 stdout/stderr/exitCode 的角色一致。
 *
 * 不变量:
 *   - run 抛错 **不**重新抛出 —— LocalTool handler 在外层会被 registry
 *     收敛成 `{ ok: false }`,但 AppCommand 抛错语义是"命令本身退出
 *     非 0",不是"工具调用失败"。这里走 stderr + exit 1,与真 shell 一致。
 *   - `ctx.signal` 取消由 run 自己透传到底层 I/O 检测;dispatcher 不主动
 *     检测,避免双重判定语义不一致。
 */

import type { ToolContext } from '../tools/types';
import type { AppCmdContext, AppCmdInternalResult, AppCommand } from './types';

/** dispatcher 自己用的简单 stdout/stderr accumulator。 */
function makeBuffer(): { write(s: string): void; read(): string } {
  // 用 array push 而不是字符串拼接 —— 命令可能高频小段输出(如表格逐行
  // print),array 在 JS 引擎里通常比反复 string concat 内存友好。
  const chunks: string[] = [];
  return {
    write(s: string) {
      if (s.length > 0) chunks.push(s);
    },
    read() {
      return chunks.join('');
    },
  };
}

/**
 * 把 `ToolContext` 收窄成 `AppCmdContext` 子集,并挂 stdio helpers。
 *
 * 故意不直接展开传 `...toolCtx`:AppCmdContext 是**精确**子集,任何字段
 * 漂移都要走类型系统强制声明,而不是靠 spread 默默继承。
 */
function buildAppCmdContext(
  toolCtx: ToolContext,
  buffers: { stdout: ReturnType<typeof makeBuffer>; stderr: ReturnType<typeof makeBuffer> },
  exit: { code: number },
  deliverables: string[],
): AppCmdContext {
  function print(text: string): void {
    buffers.stdout.write(text);
  }

  function printErr(text: string): void {
    buffers.stderr.write(text);
  }

  function setExitCode(code: number): void {
    exit.code = code;
  }

  function addDeliverable(uri: string): void {
    const trimmed = uri.trim();
    if (trimmed.length > 0 && !deliverables.includes(trimmed)) deliverables.push(trimmed);
  }

  if (toolCtx.mode === 'delegate') {
    return {
      mode: 'delegate',
      profile: toolCtx.profile,
      profileId: toolCtx.profileId,
      agentId: toolCtx.agentId,
      sessionId: toolCtx.sessionId,
      delegateId: toolCtx.delegateId,
      signal: toolCtx.signal,
      tracer: toolCtx.tracer,
      eventSender: toolCtx.eventSender,
      chunkStream: toolCtx.chunkStream,
      callId: toolCtx.callId,
      getParentContextSummary: toolCtx.getParentContextSummary,
      print,
      printErr,
      setExitCode,
      addDeliverable,
    };
  }

  return {
    mode: 'agent',
    profile: toolCtx.profile,
    profileId: toolCtx.profileId,
    agentId: toolCtx.agentId,
    sessionId: toolCtx.sessionId,
    signal: toolCtx.signal,
    tracer: toolCtx.tracer,
    eventSender: toolCtx.eventSender,
    chunkStream: toolCtx.chunkStream,
    callId: toolCtx.callId,
    getParentContextSummary: toolCtx.getParentContextSummary,
    print,
    printErr,
    setExitCode,
    addDeliverable,
  };
}

/**
 * 执行单个 AppCommand,返回内部结果。caller(`app.ts` handler)负责
 * 拼成最终的 `ToolResult.content`。
 */
export async function dispatchAppCommand(
  cmd: AppCommand,
  argv: readonly string[],
  toolCtx: ToolContext,
): Promise<AppCmdInternalResult> {
  const stdout = makeBuffer();
  const stderr = makeBuffer();
  const exit = { code: 0 };
  const deliverables: string[] = [];
  const ctx = buildAppCmdContext(toolCtx, { stdout, stderr }, exit, deliverables);

  try {
    await cmd.run(argv, ctx);
  } catch (err) {
    // run 抛错 = 命令崩溃,与 shell 进程 abort 同义。语义上不是"工具调用
    // 失败"(那是 LocalTool 层的事),所以这里就地落成 stderr + exit 1,
    // LLM 看到的还是合法的 shell-style 结果。
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`${cmd.name}: ${msg}\n`);
    exit.code = 1;
  }

  return {
    stdout: stdout.read(),
    stderr: stderr.read(),
    exitCode: exit.code,
    deliverables,
  };
}

/**
 * 把内部结果合成 LLM 可见的最终字符串。
 *
 * 格式:
 *   <stdout>            (always)
 *   <stderr if any>     (only if stderr non-empty)
 *   (exit <code>)       (only if exitCode !== 0;0 不显示,与 shell 一致)
 *
 * 不强制末尾换行 —— stdout/stderr 自己若没换行就贴着 `(exit ..)`,
 * LLM 能处理。强加换行反而可能在 stdout 末尾本就有 `\n` 时出双换行。
 */
export function formatAppCmdContent(result: AppCmdInternalResult): string {
  const parts: string[] = [];
  if (result.stdout.length > 0) parts.push(result.stdout);
  if (result.stderr.length > 0) {
    // 确保 stderr 在 stdout 之后用换行隔开(stdout 自带末尾换行就不重复加)
    if (parts.length > 0 && !result.stdout.endsWith('\n')) parts.push('\n');
    parts.push(result.stderr);
  }
  if (result.exitCode !== 0) {
    const tail = parts.length === 0 ? '' : parts[parts.length - 1].endsWith('\n') ? '' : '\n';
    parts.push(`${tail}(exit ${result.exitCode})`);
  }
  return parts.join('');
}

