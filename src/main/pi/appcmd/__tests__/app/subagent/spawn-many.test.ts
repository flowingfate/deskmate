/**
 * `subagent spawn-many` subcommand 测试 —— 覆盖 cmdline parsing / mutual
 * exclusion / per-task 解析 / --config-json escape hatch / 失败路径 /
 * signal 透传。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSubagentMocks, runSubagent, subagentMocks } from './_fixture';

beforeEach(() => {
  resetSubagentMocks();
});

describe('subagent spawn-many', () => {
  it('既无 --task 也无 --config-json → exit 2 + 提示', async () => {
    const r = await runSubagent('spawn-many');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('provide --task');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--task 与 --config-json 同时给 → exit 2 + 互斥提示', async () => {
    const r = await runSubagent([
      'spawn-many',
      '--task', 'researcher:do a',
      '--config-json', '[]',
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('mutually exclusive');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('有位置参数 → exit 2 + 提示用 --task / --config-json', async () => {
    const r = await runSubagent(['spawn-many', 'positional-arg']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unexpected positional');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('单 --task → kernel 收到一个 task,name/task 拆分正确', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true,"data":"..."}',
      ok: true,
    });
    await runSubagent(['spawn-many', '--task', 'researcher:find papers']);
    const [, , args] = subagentMocks.spawnManyInternal.mock.calls[0];
    expect(args.tasks).toEqual([
      { subAgentName: 'researcher', task: 'find papers', shareContext: false },
    ]);
  });

  it('多个 --task → kernel 收到全部 task,顺序保留', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true,"data":"..."}',
      ok: true,
    });
    await runSubagent([
      'spawn-many',
      '--task', 'researcher:find',
      '--task', 'coder:sketch',
      '--task', 'writer:draft',
    ]);
    const [, , args] = subagentMocks.spawnManyInternal.mock.calls[0];
    expect(args.tasks).toEqual([
      { subAgentName: 'researcher', task: 'find', shareContext: false },
      { subAgentName: 'coder', task: 'sketch', shareContext: false },
      { subAgentName: 'writer', task: 'draft', shareContext: false },
    ]);
  });

  it('--task entry 缺 ":" → exit 2 + 不调内核', async () => {
    const r = await runSubagent(['spawn-many', '--task', 'researcher_no_colon']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('"name:task description"');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--task entry name 为空 → exit 2', async () => {
    const r = await runSubagent(['spawn-many', '--task', ':only-task']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('empty <name>');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--task entry task 为空 → exit 2', async () => {
    const r = await runSubagent(['spawn-many', '--task', 'researcher:']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('empty <task description>');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--task entry 含多个 ":" → 首个为分隔符,task 保留剩余 ":"', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    await runSubagent(['spawn-many', '--task', 'researcher:do X: with Y']);
    const [, , args] = subagentMocks.spawnManyInternal.mock.calls[0];
    expect(args.tasks).toEqual([
      { subAgentName: 'researcher', task: 'do X: with Y', shareContext: false },
    ]);
  });

  it('cmdline-level --share-context → 应用到所有 --task entry', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    await runSubagent([
      'spawn-many',
      '--share-context',
      '--task', 'a:t1',
      '--task', 'b:t2',
    ]);
    const [, , args] = subagentMocks.spawnManyInternal.mock.calls[0];
    expect(args.tasks.every((t: { shareContext: boolean }) => t.shareContext === true)).toBe(true);
  });

  it('--config-json 有效 → 解析 per-task shareContext', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    await runSubagent([
      'spawn-many',
      '--config-json',
      '[{"name":"a","task":"t1","shareContext":true},{"name":"b","task":"t2"}]',
    ]);
    const [, , args] = subagentMocks.spawnManyInternal.mock.calls[0];
    expect(args.tasks).toEqual([
      { subAgentName: 'a', task: 't1', shareContext: true },
      { subAgentName: 'b', task: 't2', shareContext: false },
    ]);
  });

  it('--config-json 非数组 → exit 2', async () => {
    const r = await runSubagent([
      'spawn-many',
      '--config-json', '{"name":"a","task":"t"}',
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('must be an array');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--config-json JSON 解析失败 → exit 2 + 包含 "parse error"', async () => {
    const r = await runSubagent(['spawn-many', '--config-json', '{bad json']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('parse error');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--config-json 数组元素缺 name → exit 2', async () => {
    const r = await runSubagent([
      'spawn-many',
      '--config-json', '[{"task":"t1"}]',
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('.name must be a non-empty string');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--config-json 元素 shareContext 非布尔 → 视作 false', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    await runSubagent([
      'spawn-many',
      '--config-json',
      '[{"name":"a","task":"t","shareContext":"yes"}]',
    ]);
    const [, , args] = subagentMocks.spawnManyInternal.mock.calls[0];
    expect(args.tasks[0].shareContext).toBe(false);
  });

  it('--config-json 数组为空 → exit 2 + 提示 no tasks resolved', async () => {
    const r = await runSubagent(['spawn-many', '--config-json', '[]']);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('no tasks resolved');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('ctx.isSubAgent === true → exit 1 + recursion 拒绝', async () => {
    const r = await runSubagent(
      ['spawn-many', '--task', 'a:t'],
      { isSubAgent: true },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('recursion not allowed');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('ctx.getSubAgentConfig 缺失 → exit 1', async () => {
    const r = await runSubagent(
      ['spawn-many', '--task', 'a:t'],
      { getSubAgentConfig: undefined },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('getSubAgentConfig');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('kernel 返回 ok=true → exit 0', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true,"data":"### Task 1: a"}',
      ok: true,
    });
    const r = await runSubagent(['spawn-many', '--task', 'a:t']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('"success":true');
  });

  it('kernel 返回 ok=false → exit 1 + envelope 仍输出', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":false,"data":"### Task 1: a (failed)"}',
      ok: false,
    });
    const r = await runSubagent(['spawn-many', '--task', 'a:t']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('"success":false');
  });

  it('ctx.signal 透传到 kernel', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true}',
      ok: true,
    });
    const ac = new AbortController();
    await runSubagent(['spawn-many', '--task', 'a:t'], { signal: ac.signal });
    const [, ctxArg] = subagentMocks.spawnManyInternal.mock.calls[0];
    expect(ctxArg.signal).toBe(ac.signal);
  });

  it('--help → 显示 HELP 文本 + exit 0 + 不调内核', async () => {
    const r = await runSubagent('spawn-many --help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('subagent spawn-many');
    expect(r.stdout).toContain('--task');
    expect(r.stdout).toContain('--config-json');
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });
});
