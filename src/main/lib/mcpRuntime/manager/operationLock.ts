/**
 * Per-server 操作互斥锁。
 *
 * 从旧 `mcpClientManager.ts::_executeWithLock` / `_forceCancelConnection`
 * 抽出。语义:
 *   - 同一 serverName 上,connect / disconnect / reconnect 三种操作**不可
 *     并发**;第二个进来的调用直接抛错(deduplication 由背景异步任务的
 *     catch 侧处理,见 `MCPClientManager._startConnectionAsync`)。
 *   - 每把锁挂一个 `AbortController`,给强制取消路径(disconnect 强杀正在
 *     跑的 connect)当撬棍。**注意**:锁自带的 signal 目前并未透传给 action
 *     内部的连接调用,只作为 `_forceCancelConnection` 释放锁时的副产品(见
 *     该方法内注释);抽出到独立模块后保持等价语义。
 */

type LockKind = 'connect' | 'disconnect' | 'reconnect';

interface Lock {
  kind: LockKind;
  promise: Promise<void>;
  abort: AbortController;
  startedAt: number;
}

export class OperationLockRegistry {
  private readonly locks = new Map<string, Lock>();

  /**
   * 独占执行 `action`。同 serverName 已在跑相同/不同操作时抛
   * `"is currently ${kind}ing"` —— 保持旧文案,`_startConnectionAsync`
   * 的 catch 依赖字符串匹配 "is currently connecting" 做静默去重。
   */
  async run(serverName: string, kind: LockKind, action: () => Promise<void>): Promise<void> {
    const existing = this.locks.get(serverName);
    if (existing) {
      throw new Error(`Server "${serverName}" is currently ${existing.kind}ing, please wait`);
    }

    const abort = new AbortController();
    const promise = action();
    this.locks.set(serverName, {
      kind,
      promise,
      abort,
      startedAt: Date.now(),
    });

    try {
      await promise;
    } finally {
      this.locks.delete(serverName);
    }
  }

  /**
   * 强制释放锁并 abort 其 signal。给 disconnect 里"先撬掉正在跑的
   * connect"用。不 await action 的 promise —— 上游负责后续 cleanup。
   */
  forceRelease(serverName: string): void {
    const lock = this.locks.get(serverName);
    if (!lock) return;
    lock.abort.abort();
    this.locks.delete(serverName);
  }

  clear(): void {
    for (const lock of this.locks.values()) {
      lock.abort.abort();
    }
    this.locks.clear();
  }
}
