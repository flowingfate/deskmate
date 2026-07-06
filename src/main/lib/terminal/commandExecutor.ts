/**
 * 一次性命令执行 —— 纯函数，无自身状态。
 *
 * 把子进程的 close/exit/error 事件收敛成单个 TerminalResult。缓冲输出在 settle
 * 时通过 `readOutput` 回调读取（保证读到最新值），超时后先 SIGTERM 再 SIGKILL 兜底。
 */

import { ChildProcessWithoutNullStreams } from 'child_process';
import { TerminalResult } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;
const SIGKILL_FALLBACK_MS = 5_000;
// 部分 Windows shell 在被终止时只发 exit 不发 close；给 close 一点时间到达，
// 否则从 exit 兜底 settle。
const EXIT_FALLBACK_MS = 50;

interface RunCommandParams {
  child: ChildProcessWithoutNullStreams;
  timeoutMs?: number;
  /** settle 时读取当前缓冲输出与截断标记 */
  readOutput: () => { stdout: string; stderr: string; truncated: boolean };
  /** 命令开始时间戳（用于计算 durationMs） */
  startTime: number;
}

/**
 * 运行命令并等待其结束，返回归一化的 TerminalResult。
 */
export function runCommand(params: RunCommandParams): Promise<TerminalResult> {
  const { child, timeoutMs, readOutput, startTime } = params;
  const { promise, resolve, reject } = Promise.withResolvers<TerminalResult>();

  let settled = false;
  let timedOut = false;
  let exitFallbackHandle: NodeJS.Timeout | null = null;
  let sigkillFallbackHandle: NodeJS.Timeout | null = null;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    sigkillFallbackHandle = setTimeout(() => child.kill('SIGKILL'), SIGKILL_FALLBACK_MS);
  }, timeoutMs || DEFAULT_TIMEOUT_MS);

  const cleanup = () => {
    clearTimeout(timeoutHandle);
    if (exitFallbackHandle) clearTimeout(exitFallbackHandle);
    if (sigkillFallbackHandle) clearTimeout(sigkillFallbackHandle);
    child.removeListener('close', finalize);
    child.removeListener('exit', handleExit);
    child.removeListener('error', handleError);
  };

  const finalize = (code: number | null) => {
    if (settled) return;
    settled = true;
    cleanup();

    const { stdout, stderr, truncated } = readOutput();
    resolve({
      stdout,
      stderr,
      exitCode: code,
      timedOut,
      durationMs: Date.now() - startTime,
      truncated: truncated || undefined
    });
  };

  const handleExit = (code: number | null) => {
    if (settled || exitFallbackHandle) return;
    exitFallbackHandle = setTimeout(() => finalize(code), EXIT_FALLBACK_MS);
  };

  const handleError = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };

  child.once('close', finalize);
  child.once('exit', handleExit);
  child.once('error', handleError);

  return promise;
}
