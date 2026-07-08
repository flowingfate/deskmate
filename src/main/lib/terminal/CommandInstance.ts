/**
 * 一次性命令终端实例。
 *
 * 输出解释：把 stdout/stderr 收进缓冲，超 `maxOutputLength`（默认 8000）截断。
 * 通过 `execute()` 等待进程结束并返回归一化的 `TerminalResult`（委托 commandExecutor）。
 * 可为 `persistent`（如后台进程），此时靠 stdout/stderr 事件流增量消费、不调 `execute()`。
 */

import { BaseTerminalInstance } from './BaseTerminalInstance';
import { runCommand } from './commandExecutor';
import { TerminalResult } from './types';

const DEFAULT_MAX_OUTPUT = 8_000;

export class CommandInstance extends BaseTerminalInstance {
  private stdout = '';
  private stderr = '';
  private truncated = false;

  /**
   * 执行一次性命令并返回归一化结果。必要时先 `start()`（幂等：已 running 直接返回），
   * 故一次性调用方无需手动排 `start()`。流式 / 后台命令走事件流、不调 `execute()`。
   */
  public async execute(): Promise<TerminalResult> {
    if (this._state !== 'running') {
      await this.start();
    }

    return runCommand({
      child: this._process!,
      timeoutMs: this.config.timeoutMs,
      startTime: Date.now(),
      readOutput: () => ({ stdout: this.stdout, stderr: this.stderr, truncated: this.truncated })
    });
  }

  protected setupOutputHandlers(): void {
    if (!this._process) return;

    const maxLength = this.config.maxOutputLength || DEFAULT_MAX_OUTPUT;

    const handleData = (buffer: Buffer, container: 'stdout' | 'stderr') => {
      const normalized = buffer.toString('utf8').replace(/\r\n/g, '\n');
      const current = this[container];

      if (current.length + normalized.length > maxLength) {
        const remaining = Math.max(maxLength - current.length, 0);
        this[container] = current + normalized.slice(0, remaining);
        this.truncated = true;
      } else {
        this[container] = current + normalized;
      }

      this.emit(container, normalized);
    };

    this._process.stdout?.on('data', data => handleData(data as Buffer, 'stdout'));
    this._process.stderr?.on('data', data => handleData(data as Buffer, 'stderr'));
  }
}
