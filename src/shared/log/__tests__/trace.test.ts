import { describe, it, expect, vi } from 'vitest';
import { newTraceId, newSpanId, Tracer, type TraceContext } from '../trace';

const CROCKFORD = /^[0-9abcdefghjkmnpqrstvwxyz]+$/;

describe('newTraceId / newSpanId', () => {
  it('newTraceId is 6 chars Crockford32', () => {
    for (let i = 0; i < 50; i++) {
      const tid = newTraceId();
      expect(tid.length).toBe(6);
      expect(tid).toMatch(CROCKFORD);
    }
  });

  it('newSpanId is 4 chars Crockford32', () => {
    for (let i = 0; i < 50; i++) {
      const sid = newSpanId();
      expect(sid.length).toBe(4);
      expect(sid).toMatch(CROCKFORD);
    }
  });

  it('practically unique across thousands of calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(newTraceId());
    }
    // 10.7 亿空间，1000 次接近不可能碰撞；留 5 个余量作 noise tolerance（实际上从未观测到 <1000）
    expect(seen.size).toBeGreaterThanOrEqual(995);
  });
});

describe('Tracer — serialize / deserialize', () => {
  it('serialize requires sid (顶层未 derive 前禁止序列化)', () => {
    const t = Tracer.start();
    expect(() => t.serialize()).toThrow();
  });

  it('serialize → deserialize 还原 tid/sid/startAt，并把 ctx.sid 作为接收端的 self.sid', () => {
    const upstream = Tracer.startWithSpan().bind({ mod: 'chat.send' });
    const ctx = upstream.serialize();
    expect(ctx.tid).toBe(upstream.tid);
    expect(ctx.sid).toBe(upstream.sid);
    expect(ctx.startAt).toBe(upstream.startAt);
    expect(ctx.psid).toBeUndefined(); // upstream 顶层无 parent

    const received = Tracer.deserialize(ctx);
    expect(received.tid).toBe(ctx.tid);
    expect(received.sid).toBe(ctx.sid);
    expect(received.startAt).toBe(ctx.startAt);
  });

  it('deserialize 出的 tracer 一次 derive 后 psid 等于 ctx.sid（这是修 chat.turn 断链的关键）', () => {
    const upstream = Tracer.startWithSpan().bind({ mod: 'chat.send' });
    const ctx = upstream.serialize();
    // 接收端：模拟 chat.ipc 入口
    const ipc = Tracer.deserialize(ctx).derive().bind({ mod: 'chat.ipc' });
    const ipcFields = ipc.fields({ msg: 'stream start' });
    expect(ipcFields.tid).toBe(ctx.tid);
    expect(ipcFields.psid).toBe(ctx.sid);     // chat.ipc.psid = chat.send.sid ✓
    expect(ipcFields.sid).not.toBe(ctx.sid);  // chat.ipc 自己有新 sid

    // 再 derive 一层模拟 chat.turn，psid 链应继续指向 chat.ipc
    const turn = ipc.derive().bind({ mod: 'chat.turn' });
    const turnFields = turn.fields({ msg: 'turn start' });
    expect(turnFields.tid).toBe(ctx.tid);
    expect(turnFields.psid).toBe(ipcFields.sid);
  });

  it('rootDur 跨 deserialize 仍以 ctx.startAt 起算', () => {
    // 用 fake timer 精确推进时钟，避免真实 setTimeout 让 rootDur 卡在临界值上 flake
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const upstream = Tracer.startWithSpan(); // startAt = 0
      const ctx = upstream.serialize();
      // 前进 5ms 模拟跨进程传输延迟
      vi.setSystemTime(5);
      const received = Tracer.deserialize(ctx); // startAt 保留 = 0
      const child = received.derive();           // child.startAt = 5，root().startAt = 0
      // 再前进 3ms，让 self dur / rootDur 都是确定值
      vi.setSystemTime(8);
      // child.rootDur = now(8) - root.startAt(0) = 8，含传输延迟
      expect(child.rootDur).toBe(8);
      // child.dur (self) = now(8) - child.startAt(5) = 3，不含传输延迟
      expect(child.dur).toBe(3);
      expect(child.dur).toBeLessThan(child.rootDur);
    } finally {
      vi.useRealTimers();
    }
  });

  it('deserialize 带 psid 时 stub parent 不污染下游字段', () => {
    const ctx: TraceContext = { tid: 'tid123', sid: 'csid', psid: 'psid', startAt: Date.now() };
    const received = Tracer.deserialize(ctx);
    // received.fields() 自身应能拿到 psid
    const selfFields = received.fields({ msg: 'x' });
    expect(selfFields.tid).toBe('tid123');
    expect(selfFields.sid).toBe('csid');
    expect(selfFields.psid).toBe('psid');

    // 下游 derive 后的 psid 应等于 ctx.sid（不是 ctx.psid）
    const childFields = received.derive().fields({ msg: 'y' });
    expect(childFields.psid).toBe('csid');
  });
});

describe('Tracer — derive bindings isolation', () => {
  it('derive 浅拷贝 bindings：父之后 bind 不会污染子', () => {
    const parent = Tracer.startWithSpan().bind({ chatSessionId: 's1' });
    const child = parent.derive();
    // 父再 bind 新字段
    parent.bind({ extra: 'parent-only' });
    const childFields = child.fields({ msg: 'x' });
    expect(childFields.chatSessionId).toBe('s1');  // 父 derive 时的状态保留
    expect(childFields.extra).toBeUndefined();     // 父后续 bind 不影响子
  });
});
