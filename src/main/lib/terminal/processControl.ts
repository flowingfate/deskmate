/**
 * 子进程控制 —— 流拆分与优雅关闭状态机。
 *
 * 这里的两个类是**有状态**的辅助（缓冲区 / 关闭阶段），故保留为 class；
 * 而杀进程树是纯逻辑，抽成独立函数 `killProcessTree`。
 */

import { EventEmitter } from 'events';
import { exec, ChildProcessWithoutNullStreams } from 'child_process';

/**
 * 按分隔符切分的流拆分器 —— 处理以换行分隔的消息。
 */
export class StreamSplitter extends EventEmitter {
  private buffer = '';

  constructor(private delimiter: string) {
    super();
  }

  write(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const parts = this.buffer.split(this.delimiter);
    this.buffer = parts.pop() || '';

    for (const part of parts) {
      this.emit('data', Buffer.from(part));
    }
  }
}

/**
 * 杀掉整棵进程树。Windows 用 taskkill，Unix 用 pkill。
 * @param force true 用强制信号（/F 或 -9），否则用温和信号（/T 或 -15）
 */
export function killProcessTree(pid: number, force: boolean): Promise<void> {
  const command = process.platform === 'win32'
    ? `taskkill ${force ? '/F' : '/T'} /PID ${pid}`
    : `pkill -${force ? '9' : '15'} -P ${pid}`;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  exec(command, (error) => {
    if (error) reject(error);
    else resolve();
  });
  return promise;
}

/**
 * 终端优雅关闭状态机。
 *
 * 关闭流程：先 end stdin（给进程自行退出的宽限期）→ 温和杀进程树（SIGTERM/-15）
 * → 强制杀进程树（SIGKILL/-9）。每一步之间用定时器推进。
 */
export class TerminalStateHandler {
  private static readonly GRACE_TIME_MS = 10_000;

  private processState: 'running' | 'stdinEnded' | 'killedPolite' | 'killedForceful' = 'running';
  private nextTimeout?: NodeJS.Timeout;

  public get stopped(): boolean {
    return this.processState !== 'running';
  }

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly graceTimeMs: number = TerminalStateHandler.GRACE_TIME_MS
  ) {}

  /**
   * 开始优雅关闭流程。首次调用进入宽限期；再次调用直接强制杀。
   */
  public stop(): void {
    if (this.processState === 'running') {
      let graceTime = this.graceTimeMs;
      try {
        this.child.stdin.end();
      } catch {
        graceTime = 1; // stdin 已不可用，几乎立即推进
      }
      this.processState = 'stdinEnded';
      this.nextTimeout = setTimeout(() => this.killPolite(), graceTime);
    } else {
      this.clearTimeout();
      this.killForceful();
    }
  }

  public write(message: string): void {
    if (!this.stopped) {
      this.child.stdin.write(message + '\n');
    }
  }

  public dispose(): void {
    this.clearTimeout();
  }

  private async killPolite(): Promise<void> {
    this.processState = 'killedPolite';
    this.nextTimeout = setTimeout(() => this.killForceful(), this.graceTimeMs);

    if (this.child.pid) {
      await killProcessTree(this.child.pid, false);
    } else {
      this.child.kill('SIGTERM');
    }
  }

  private async killForceful(): Promise<void> {
    this.processState = 'killedForceful';

    if (this.child.pid) {
      try {
        await killProcessTree(this.child.pid, true);
      } catch {
        this.child.kill('SIGKILL');
      }
    } else {
      this.child.kill();
    }
  }

  private clearTimeout(): void {
    if (this.nextTimeout) {
      clearTimeout(this.nextTimeout);
      this.nextTimeout = undefined;
    }
  }
}
