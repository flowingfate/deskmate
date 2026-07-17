/**
 * Per-server 操作互斥锁。
 *
 * 同一 serverName 上的 connect / disconnect / reconnect 不可并发。前台调用
 * 直接失败；配置更新的后台重连使用 `runWhenIdle()` 等待前一操作收尾后再执行。
 */

type LockKind = 'connect' | 'disconnect' | 'reconnect';

interface Lock {
  kind: LockKind;
  promise: Promise<void>;
}

export class OperationLockRegistry {
  private readonly locks = new Map<string, Lock>();

  /** 独占执行 action；同 serverName 已在跑任意操作时直接报错。 */
  async run(serverName: string, kind: LockKind, action: () => Promise<void>): Promise<void> {
    const existing = this.locks.get(serverName);
    if (existing) {
      throw new Error(`Server "${serverName}" is currently ${existing.kind}ing, please wait`);
    }

    const promise = action();
    this.locks.set(serverName, { kind, promise });

    try {
      await promise;
    } finally {
      // action 可能在自己收尾时触发后继操作；只能删除仍属于本次的锁。
      if (this.locks.get(serverName)?.promise === promise) {
        this.locks.delete(serverName);
      }
    }
  }

  /** 等待当前操作完成后再独占执行，保留前台调用的 fast-fail 语义。 */
  async runWhenIdle(serverName: string, kind: LockKind, action: () => Promise<void>): Promise<void> {
    for (;;) {
      const existing = this.locks.get(serverName);
      if (!existing) {
        return this.run(serverName, kind, action);
      }
      await existing.promise.catch(() => undefined);
    }
  }

  clear(): void {
    this.locks.clear();
  }
}
