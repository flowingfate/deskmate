/**
 * `ToolsRegistry` + `lazy(...)` 单测。
 *
 * 测点:
 *   - register 重名 throw,杜绝静默覆盖。
 *   - executeLocalTool 将 handler throw / signal aborted 收敛成 `{ ok: false, error }`，
 *     turn loop 上游靠这个稳定形态写 tool_result。
 *   - executeLocalTool 把 caller 给的 ctx 原样透传给 handler(handler 看到的
 *     signal / callId / chunkStream 与 caller 完全一致 —— "handler 显式
 *     拿 ctx,不读全局"的核心 invariant)。
 *   - `lazy(spec, loader)`:spec 立刻可见;handler 首次调用才走 loader;
 *     并发首调共享同一 inflight promise;loader 抛错被执行 helper 统一
 *     收敛成 `{ ok: false }`。
 */

import { describe, it, expect, vi } from 'vitest';

import { executeLocalTool, ToolsRegistry } from '../registry';
import { lazy } from '../lazy';
import type { AgentToolContext, LocalTool, ToolContext } from '../types';
import { Tracer } from '@shared/log/trace';
import { testProfile } from './profileFixture';

/** 构造一个最小可用 ToolContext。caller 可按需 override 单个字段。 */
function makeCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    profile: testProfile,
    profileId: 'p',
    agentId: 'a',
    sessionId: 's',
    signal: new AbortController().signal,
    eventSender: null,
    tracer: Tracer.noop,
    callId: 'c',
    chunkStream: null,
    ...overrides,
    mode: 'agent',
  };
}

function makeTool(name: string, handler: LocalTool['handler']): LocalTool {
  return {
    spec: { name, description: '', parameters: {} as never },
    handler,
  };
}

describe('ToolsRegistry', () => {
  it('register 重名直接 throw —— 模块加载期暴露冲突,优于运行时静默覆盖', () => {
    const r = new ToolsRegistry();
    r.register(makeTool('x', async () => ({ ok: true, content: '' })));
    expect(() =>
      r.register(makeTool('x', async () => ({ ok: true, content: '' }))),
    ).toThrow(/duplicate/);
  });

  it('has / get / list / listSpecs / listNames 反映已注册的工具', () => {
    const r = new ToolsRegistry();
    const t1 = makeTool('a', async () => ({ ok: true, content: 'A' }));
    const t2 = makeTool('b', async () => ({ ok: true, content: 'B' }));
    r.register(t1);
    r.register(t2);
    expect(r.has('a')).toBe(true);
    expect(r.has('missing')).toBe(false);
    expect(r.get('a')).toBe(t1);
    expect(r.list()).toEqual([t1, t2]);
    expect(r.listSpecs().map((s) => s.name)).toEqual(['a', 'b']);
    expect(r.listNames()).toEqual(['a', 'b']);
  });

  it('executeLocalTool handler throw 被收敛为 { ok: false, error: message }', async () => {
    const result = await executeLocalTool(
      makeTool('boom', async () => { throw new Error('kaboom'); }),
      {},
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('kaboom');
  });

  it('executeLocalTool 在 signal 已 aborted 时不调 handler,直接 { ok: false }', async () => {
    const handler = vi.fn(async () => ({ ok: true as const, content: '' }));
    const aborter = new AbortController();
    aborter.abort();
    const result = await executeLocalTool(
      makeTool('x', handler),
      {},
      makeCtx({ signal: aborter.signal }),
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/aborted/);
  });

  it('executeLocalTool 原样透传 caller ctx', async () => {
    let seenCtx: ToolContext | null = null;
    const callerSignal = new AbortController().signal;
    const callerCtx = makeCtx({
      callId: 'tc_real',
      signal: callerSignal,
      chunkStream: null,
    });

    const result = await executeLocalTool(
      makeTool('echo', async (_args, ctx) => {
        seenCtx = ctx;
        return { ok: true, content: 'ok' };
      }),
      { foo: 1 },
      callerCtx,
    );
    expect(result.ok).toBe(true);
    expect(seenCtx).toBeTruthy();
    expect(seenCtx!.callId).toBe('tc_real');
    expect(seenCtx!.signal).toBe(callerSignal);
    expect(seenCtx!.chunkStream).toBeNull();
    expect(seenCtx!.profileId).toBe(callerCtx.profileId);
    expect(seenCtx!.agentId).toBe(callerCtx.agentId);
  });
});

describe('lazy(spec, loader)', () => {
  const specA = {
    name: 'heavy',
    description: 'h',
    parameters: {} as never,
  } as const;

  it('spec 在模块加载期就可见,不依赖 loader 是否被触发', () => {
    const loader = vi.fn(async () => async () => ({ ok: true as const, content: '' }));
    const tool = lazy(specA, loader);
    // spec 立刻能拿,LLM 列表 / IPC getAll 都不会被 loader 阻塞。
    expect(tool.spec).toBe(specA);
    expect(loader).not.toHaveBeenCalled();
  });

  it('handler 首次调用才解析 loader;后续命中缓存,loader 只调一次', async () => {
    const realHandler = vi.fn(async () => ({ ok: true as const, content: 'first' }));
    const loader = vi.fn(async () => realHandler);
    const tool = lazy(specA, loader);

    await tool.handler({}, makeCtx());
    await tool.handler({}, makeCtx());
    await tool.handler({}, makeCtx());

    expect(loader).toHaveBeenCalledTimes(1);
    expect(realHandler).toHaveBeenCalledTimes(3);
  });

  it('并发首调共享同一 inflight,loader 仍只评估一次', async () => {
    let resolve!: (h: (a: unknown, c: ToolContext) => Promise<{ ok: true; content: string }>) => void;
    const inflight = new Promise<(a: unknown, c: ToolContext) => Promise<{ ok: true; content: string }>>((r) => {
      resolve = r;
    });
    const loader = vi.fn(() => inflight);
    const tool = lazy(specA, loader);

    const realHandler = vi.fn(async () => ({ ok: true as const, content: 'shared' }));
    const p1 = tool.handler({}, makeCtx());
    const p2 = tool.handler({}, makeCtx());
    const p3 = tool.handler({}, makeCtx());
    // 即使三个并发调用,loader 工厂仍只生成一个待解析 promise。
    expect(loader).toHaveBeenCalledTimes(1);

    resolve(realHandler);
    await Promise.all([p1, p2, p3]);

    expect(realHandler).toHaveBeenCalledTimes(3);
    // 后续调用也复用,不再调 loader。
    await tool.handler({}, makeCtx());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('loader 抛错被 executeLocalTool 统一收敛为 { ok: false, error }', async () => {
    const result = await executeLocalTool(
      lazy(specA, async () => { throw new Error('import failed'); }),
      {},
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/import failed/);
  });
});
