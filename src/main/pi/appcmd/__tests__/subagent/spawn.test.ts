/**
 * `subagent spawn` subcommand 测试 —— 覆盖 cmdline parsing / 缺位置参数 /
 * ctx 校验失败 / kernel 调用透传 / success+failure envelope / signal 透传。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSubagentMocks, runSubagent, subagentMocks } from './_fixture';

beforeEach(() => {
  resetSubagentMocks();
});

describe('subagent spawn', () => {
  it('缺 <name> 与 <task> → exit 2 + 提示 --help', async () => {
    const r = await runSubagent('spawn');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('requires <name> and <task>');
    expect(r.stderr).toContain('subagent spawn --help');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('只有 <name> 缺 <task> → exit 2', async () => {
    const r = await runSubagent(['spawn', 'researcher']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('requires <name> and <task>');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('多余位置参数 → exit 2', async () => {
    const r = await runSubagent(['spawn', 'researcher', 'task one', 'task two']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('too many positional args');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('<name> 是空白字符串 → exit 2 + 不调内核', async () => {
    const r = await runSubagent(['spawn', '   ', 'do something']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('<name> must be non-empty');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('<task> 是空白字符串 → exit 2 + 不调内核', async () => {
    const r = await runSubagent(['spawn', 'researcher', '   ']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('<task> must be non-empty');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('ctx.isSubAgent === true → exit 1 + recursion error + 不调内核', async () => {
    const r = await runSubagent(['spawn', 'researcher', 'task'], { isSubAgent: true });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('recursion not allowed');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('ctx.getSubAgentConfig 缺失 → exit 1 + 提示 + 不调内核', async () => {
    const r = await runSubagent(['spawn', 'researcher', 'task'], { getSubAgentConfig: undefined });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('getSubAgentConfig');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('ctx.getParentContextSummary 缺失 → exit 1 + 提示 + 不调内核', async () => {
    const r = await runSubagent(['spawn', 'researcher', 'task'], { getParentContextSummary: undefined });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('getParentContextSummary');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('成功路径:内核返回 ok=true → exit 0 + stdout 是 envelope content', async () => {
    subagentMocks.spawnSingleInternal.mockResolvedValueOnce({
      content: JSON.stringify({ success: true, data: 'done' }),
      ok: true,
    });
    const r = await runSubagent(['spawn', 'researcher', 'find papers']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('"success":true');
    expect(r.stdout).toContain('"data":"done"');
    expect(subagentMocks.spawnSingleInternal).toHaveBeenCalledTimes(1);
  });

  it('失败路径:内核返回 ok=false → exit 1 + envelope 仍输出', async () => {
    subagentMocks.spawnSingleInternal.mockResolvedValueOnce({
      content: JSON.stringify({ success: false, error: 'not found' }),
      ok: false,
    });
    const r = await runSubagent(['spawn', 'researcher', 'find papers']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('"success":false');
    expect(r.stdout).toContain('"error":"not found"');
  });

  it('默认不传 --share-context → kernel 收到 shareContext: false', async () => {
    subagentMocks.spawnSingleInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    await runSubagent(['spawn', 'researcher', 'task']);
    const [, , args] = subagentMocks.spawnSingleInternal.mock.calls[0];
    expect(args.shareContext).toBe(false);
  });

  it('--share-context → kernel 收到 shareContext: true', async () => {
    subagentMocks.spawnSingleInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    await runSubagent(['spawn', 'researcher', 'task', '--share-context']);
    const [, , args] = subagentMocks.spawnSingleInternal.mock.calls[0];
    expect(args.shareContext).toBe(true);
  });

  it('ctx.signal 透传到 kernel(spawnSingleInternal 收到的 ctx.signal === 外部 signal)', async () => {
    subagentMocks.spawnSingleInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    const ac = new AbortController();
    await runSubagent(['spawn', 'researcher', 'task'], { signal: ac.signal });
    const [, ctxArg] = subagentMocks.spawnSingleInternal.mock.calls[0];
    expect(ctxArg.signal).toBe(ac.signal);
  });

  it('ctx.callId / agentId / sessionId / profileId 透传到 kernel', async () => {
    subagentMocks.spawnSingleInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    await runSubagent(['spawn', 'researcher', 'task'], {
      callId: 'call-xyz',
      agentId: 'agent-a1',
      sessionId: 'sess-s2',
      profileId: 'prof-p3',
    });
    const [, ctxArg, args] = subagentMocks.spawnSingleInternal.mock.calls[0];
    expect(ctxArg.callId).toBe('call-xyz');
    expect(ctxArg.agentId).toBe('agent-a1');
    expect(ctxArg.sessionId).toBe('sess-s2');
    expect(ctxArg.profileId).toBe('prof-p3');
    expect(args.subAgentName).toBe('researcher');
    expect(args.task).toBe('task');
  });

  it('--help → 显示 HELP 文本 + exit 0 + 不调内核', async () => {
    const r = await runSubagent('spawn --help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('subagent spawn <name> <task>');
    expect(r.stdout).toContain('--share-context');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('未知 flag → exit 2 + 提示 parse error + 不调内核', async () => {
    const r = await runSubagent(['spawn', 'researcher', 'task', '--bogus']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('subagent spawn:');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });
});
