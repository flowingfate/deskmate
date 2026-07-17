/**
 * `AppCommandRegistry` + `dispatchAppCommand` + `formatAppCmdContent` 单测。
 *
 * 测点:
 *   - registry 重名 throw(与 LocalTool registry 同纪律)
 *   - list 按 name 升序稳定
 *   - dispatcher 把 stdio helpers 接进 buffer,run 通过 helpers 输出
 *   - run 抛错 → 收敛为 stderr + exit 1,不重新抛
 *   - formatAppCmdContent 三段拼接规则:
 *       * 只有 stdout
 *       * stdout + stderr
 *       * stdout 末尾换行处理(不重复换行)
 *       * exitCode == 0 时不输出 "(exit 0)" 行
 *       * exitCode != 0 时追加 "(exit N)"
 *   - signal 已 aborted 时 dispatcher 仍跑 run(取消透传是 run 自己的事)
 */

import { describe, it, expect } from 'vitest';

import { dispatchAppCommand, formatAppCmdContent } from '../dispatcher';
import { AppCommandRegistry } from '../registry';
import type { AppCommand, AppCmdContext } from '../types';
import type { AgentToolContext, DelegateToolContext } from '../../tools/types';
import { Tracer } from '@shared/log/trace';
import { testProfile } from '../../tools/__tests__/profileFixture';

function makeToolCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
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

function makeDelegateToolCtx(
  overrides: Partial<DelegateToolContext> = {},
): DelegateToolContext {
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
    delegateId: 'd',
    ...overrides,
    mode: 'delegate',
  };
}

function makeCmd(name: string, run: AppCommand['run']): AppCommand {
  return {
    name,
    synopsis: `synopsis for ${name}`,
    help: `help for ${name}`,
    run,
  };
}

describe('AppCommandRegistry', () => {
  it('register 重名直接 throw —— 与 LocalTool registry 同纪律', () => {
    const reg = new AppCommandRegistry();
    reg.register(makeCmd('foo', async () => {}));
    expect(() => reg.register(makeCmd('foo', async () => {}))).toThrow(/duplicate command name: foo/);
  });

  it('has / get / list / listNames 反映已注册命令', () => {
    const reg = new AppCommandRegistry();
    const a = makeCmd('alpha', async () => {});
    const b = makeCmd('beta', async () => {});
    reg.register(b);
    reg.register(a);
    expect(reg.has('alpha')).toBe(true);
    expect(reg.has('zeta')).toBe(false);
    expect(reg.get('alpha')).toBe(a);
    // list 按 name 升序,不按注册顺序 —— 让 `app --help` 输出稳定
    expect(reg.list().map((c) => c.name)).toEqual(['alpha', 'beta']);
    expect(reg.listNames()).toEqual(['alpha', 'beta']);
  });
});

describe('dispatchAppCommand', () => {
  it('run 通过 print / printErr / setExitCode 写入,dispatcher 收集成 internal result', async () => {
    const cmd = makeCmd('demo', async (argv, ctx: AppCmdContext) => {
      ctx.print('hello');
      ctx.print(' world\n');
      ctx.printErr('warning!\n');
      ctx.setExitCode(7);
      expect(argv).toEqual(['arg1', 'arg2']);
    });
    const r = await dispatchAppCommand(cmd, ['arg1', 'arg2'], makeToolCtx());
    expect(r.stdout).toBe('hello world\n');
    expect(r.stderr).toBe('warning!\n');
    expect(r.exitCode).toBe(7);
  });

  it('run 抛错 → 收敛为 stderr + exit 1,不重新抛(语义=命令崩溃 ≠ 工具失败)', async () => {
    const cmd = makeCmd('boom', async () => {
      throw new Error('something broke');
    });
    const r = await dispatchAppCommand(cmd, [], makeToolCtx());
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('boom: something broke\n');
    expect(r.exitCode).toBe(1);
  });

  it('run 抛非 Error(string/object) → 也被收敛', async () => {
    const cmd = makeCmd('weird', async () => {
      throw 'raw string';
    });
    const r = await dispatchAppCommand(cmd, [], makeToolCtx());
    expect(r.stderr).toMatch(/weird: raw string/);
    expect(r.exitCode).toBe(1);
  });

  it('ctx 子集字段透传(profileId/agentId/sessionId/signal/...)', async () => {
    let captured: AppCmdContext | null = null;
    const cmd = makeCmd('cap', async (_argv, ctx) => {
      captured = ctx;
    });
    const ac = new AbortController();
    const toolCtx = makeToolCtx({
      profileId: 'P1',
      agentId: 'A1',
      sessionId: 'S1',
      callId: 'C1',
      signal: ac.signal,
    });
    await dispatchAppCommand(cmd, [], toolCtx);
    expect(captured).not.toBeNull();
    expect(captured!.profileId).toBe('P1');
    expect(captured!.agentId).toBe('A1');
    expect(captured!.sessionId).toBe('S1');
    expect(captured!.callId).toBe('C1');
    expect(captured!.signal).toBe(ac.signal);
    expect(captured!.mode).toBe('agent');
    expect(captured!.getParentContextSummary).toBeUndefined();
    expect(Object.hasOwn(captured!, 'catalog')).toBe(false);
  });

  it('delegate mode 与 delegateId 透传到 AppCmdContext', async () => {
    let captured: AppCmdContext | null = null;
    const cmd = makeCmd('cap', async (_argv, ctx) => {
      captured = ctx;
    });
    await dispatchAppCommand(cmd, [], makeDelegateToolCtx({ delegateId: 'delegate-1' }));
    expect(captured!.mode).toBe('delegate');
    if (captured!.mode === 'delegate') expect(captured!.delegateId).toBe('delegate-1');
  });

  it('parent summary getter 透传引用相同', async () => {
    let captured: AppCmdContext | null = null;
    const cmd = makeCmd('cap', async (_argv, ctx) => {
      captured = ctx;
    });
    const getParentContextSummary = async () => 'parent';
    await dispatchAppCommand(
      cmd,
      [],
      makeToolCtx({ getParentContextSummary }),
    );
    expect(captured!.getParentContextSummary).toBe(getParentContextSummary);
  });

  it('signal 已 aborted 时 dispatcher 仍调 run —— 取消透传是 run 自己的责任', async () => {
    const ac = new AbortController();
    ac.abort();
    let ran = false;
    const cmd = makeCmd('chk', async (_argv, ctx) => {
      ran = true;
      expect(ctx.signal.aborted).toBe(true);
    });
    await dispatchAppCommand(cmd, [], makeToolCtx({ signal: ac.signal }));
    expect(ran).toBe(true);
  });
});

describe('formatAppCmdContent', () => {
  it('只有 stdout,exit 0 → 不附加 (exit 0)', () => {
    expect(formatAppCmdContent({ stdout: 'hello\n', stderr: '', exitCode: 0 })).toBe('hello\n');
  });

  it('stdout + stderr,exit 0 → 无尾巴 (exit 0)', () => {
    expect(formatAppCmdContent({ stdout: 'out\n', stderr: 'err\n', exitCode: 0 })).toBe('out\nerr\n');
  });

  it('stdout 末尾无换行时,stderr 前自动加一个换行', () => {
    expect(formatAppCmdContent({ stdout: 'out', stderr: 'err\n', exitCode: 0 })).toBe('out\nerr\n');
  });

  it('exit !=0 → 末尾追加 (exit N)', () => {
    expect(formatAppCmdContent({ stdout: 'out\n', stderr: '', exitCode: 42 })).toBe('out\n(exit 42)');
  });

  it('exit !=0 且 stdout 末尾无换行 → (exit) 前自动加换行', () => {
    expect(formatAppCmdContent({ stdout: 'out', stderr: '', exitCode: 1 })).toBe('out\n(exit 1)');
  });

  it('全空 + exit !=0 → 只输出 (exit N)', () => {
    expect(formatAppCmdContent({ stdout: '', stderr: '', exitCode: 1 })).toBe('(exit 1)');
  });

  it('stderr 末尾自带换行时不重复加', () => {
    expect(formatAppCmdContent({ stdout: 'out\n', stderr: 'err\n', exitCode: 2 })).toBe('out\nerr\n(exit 2)');
  });
});
