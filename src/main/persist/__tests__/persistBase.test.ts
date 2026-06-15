import { describe, expect, it } from 'vitest';
import { PersistBase } from '../lib/persistBase';

/** 暴露最小测试入口：每次 doPersist 拍当前 counter 做快照。 */
class TestStore extends PersistBase {
  public counter = 0;
  public snapshots: number[] = [];
  public doPersistCalls = 0;

  /** 注入式：让测试控制 doPersist 的内部行为（延迟、抛错等）。 */
  public hook: (snapshot: number) => Promise<void> = async () => {};

  protected async doPersist(): Promise<void> {
    this.doPersistCalls++;
    const snap = this.counter;        // 写盘前先拍快照
    await this.hook(snap);            // 模拟 IO 异步
    this.snapshots.push(snap);        // 实际"落盘"
  }
}

/** flushMicrotasks —— 把所有 pending micro-task 推完。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('PersistBase', () => {
  it('单次 mutate + persist → doPersist 调一次，await 后已落盘', async () => {
    const s = new TestStore();
    s.counter = 1;
    await s.persist();
    expect(s.doPersistCalls).toBe(1);
    expect(s.snapshots).toEqual([1]);
  });

  it('同步连续多次 persist 合并为一次写', async () => {
    const s = new TestStore();
    s.counter = 1;
    const p1 = s.persist();
    s.counter = 2;
    const p2 = s.persist();
    s.counter = 3;
    const p3 = s.persist();
    await Promise.all([p1, p2, p3]);
    expect(s.doPersistCalls).toBe(1);
    expect(s.snapshots).toEqual([3]);
    expect(s.isPersisting).toBe(false);
  });

  it('写盘期间到来的 mutate 触发第二轮 doPersist，捎上新数据', async () => {
    const s = new TestStore();
    let resolveFirst!: () => void;
    let calls = 0;
    s.hook = async () => {
      calls++;
      if (calls === 1) {
        await new Promise<void>((r) => { resolveFirst = r; });
      }
    };

    s.counter = 1;
    const p1 = s.persist();           // 进入第一轮 doPersist 并卡住
    await flushMicrotasks();
    expect(s.doPersistCalls).toBe(1);

    // 第一轮在飞行中，注入新 mutate
    s.counter = 2;
    const p2 = s.persist();
    expect(s.doPersistCalls).toBe(1);  // 还没起第二轮

    resolveFirst();                   // 解锁第一轮
    await p1;
    await p2;
    expect(s.doPersistCalls).toBe(2);
    expect(s.snapshots).toEqual([1, 2]);
    expect(s.isPersisting).toBe(false);
  });

  it('awaiter 拿到 resolve 后，自己之前的 mutate 已落盘', async () => {
    const s = new TestStore();
    let resolveFirst!: () => void;
    let calls = 0;
    s.hook = async () => {
      calls++;
      if (calls === 1) await new Promise<void>((r) => { resolveFirst = r; });
    };

    s.counter = 1;
    const p1 = s.persist();
    await flushMicrotasks();
    s.counter = 2;
    const p2 = s.persist();

    // p2 不能在 counter=2 落盘前 resolve
    let p2Resolved = false;
    p2.then(() => { p2Resolved = true; });
    await flushMicrotasks();
    expect(p2Resolved).toBe(false);

    resolveFirst();
    await p1;
    await p2;
    expect(p2Resolved).toBe(true);
    expect(s.snapshots).toEqual([1, 2]);
  });

  it('doPersist throw → 所有共享 awaiter 收到错误，下次 persist 能重试', async () => {
    const s = new TestStore();
    let mode: 'throw' | 'ok' = 'throw';
    s.hook = async () => {
      if (mode === 'throw') throw new Error('disk full');
    };

    s.counter = 1;
    const p1 = s.persist();
    s.counter = 2;
    const p2 = s.persist();     // 与 p1 共享同一 promise

    await expect(p1).rejects.toThrow('disk full');
    await expect(p2).rejects.toThrow('disk full');
    expect(s.isPersisting).toBe(false);

    // 重试
    mode = 'ok';
    s.counter = 3;
    await s.persist();
    expect(s.snapshots).toEqual([3]);
  });

  it('串行（await 间）多次 persist → 每次都触发新一轮 doPersist', async () => {
    const s = new TestStore();
    s.counter = 1;
    await s.persist();
    s.counter = 2;
    await s.persist();
    s.counter = 3;
    await s.persist();
    expect(s.doPersistCalls).toBe(3);
    expect(s.snapshots).toEqual([1, 2, 3]);
  });

  it('多个独立实例互不干扰', async () => {
    const a = new TestStore();
    const b = new TestStore();
    a.counter = 10;
    b.counter = 20;
    await Promise.all([a.persist(), b.persist()]);
    expect(a.snapshots).toEqual([10]);
    expect(b.snapshots).toEqual([20]);
  });

  it('persist 自身在 doPersist 中调用不会爆栈或死锁（被合并到 trailing 轮）', async () => {
    // 模拟："写完后 onChange 又触发了 persist"——不应该死循环或爆栈。
    const s = new TestStore();
    let reentered = false;
    s.hook = async () => {
      if (!reentered) {
        reentered = true;
        s.counter = 99;
        // 不 await，模拟 onChange 触发后的 fire-and-forget 链路
        void s.persist();
      }
    };
    s.counter = 1;
    await s.persist();
    // 第二轮还在飞，等它完
    while (s.isPersisting) await flushMicrotasks();
    expect(s.doPersistCalls).toBe(2);
    expect(s.snapshots).toEqual([1, 99]);
  });
});
