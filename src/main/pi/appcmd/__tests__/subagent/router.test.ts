/**
 * `subagent` router 测试 —— 顶层 cmdline dispatch、HELP_TOP、未知子命令、
 * registry 命中。覆盖 AppCommand object level 的行为,subcommand 内部
 * 业务由 `spawn.test.ts` / `spawn-many.test.ts` 覆盖。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { appCommands } from '@main/pi/appcmd/registry';

import { resetSubagentMocks, runSubagent, subagentMocks } from './_fixture';

beforeEach(() => {
  resetSubagentMocks();
});

describe('subagent router', () => {
  it('appCommands 单例已注册 subagent', () => {
    // fixture 顶层有 `has() ? noop : register`,等价"无论 feature flag 状态都可见"。
    expect(appCommands.has('subagent')).toBe(true);
  });

  it('subagentCommand.synopsis 是简短一行(≤ 80 字符)', () => {
    const cmd = appCommands.get('subagent');
    expect(cmd).toBeDefined();
    expect(cmd!.synopsis.length).toBeLessThanOrEqual(80);
    expect(cmd!.synopsis).not.toContain('\n');
  });

  it('空 cmdline → 顶层 HELP_TOP + exit 0', async () => {
    const r = await runSubagent('');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('SUBCOMMANDS');
    expect(r.stdout).toContain('spawn <name> <task>');
    expect(r.stdout).toContain('spawn-many');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('--help → HELP_TOP + exit 0', async () => {
    const r = await runSubagent('--help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('Sub-agents cannot spawn other sub-agents');
  });

  it('-h → HELP_TOP + exit 0', async () => {
    const r = await runSubagent('-h');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
  });

  it('未知 subcommand → exit 2 + 提示 --help', async () => {
    const r = await runSubagent('bogus-sub');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('subagent: unknown subcommand "bogus-sub"');
    expect(r.stderr).toContain('subagent --help');
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('spawn 路由到 runSpawn(走完 happy path 用 mock 验证)', async () => {
    subagentMocks.spawnSingleInternal.mockResolvedValueOnce({
      content: '{"success":true,"data":"x"}',
      ok: true,
    });
    const r = await runSubagent(['spawn', 'researcher', 'task description']);
    expect(r.exitCode).toBe(0);
    expect(subagentMocks.spawnSingleInternal).toHaveBeenCalledTimes(1);
    expect(subagentMocks.spawnManyInternal).not.toHaveBeenCalled();
  });

  it('spawn-many 路由到 runSpawnMany', async () => {
    subagentMocks.spawnManyInternal.mockResolvedValueOnce({
      content: '{"success":true,"data":"x"}',
      ok: true,
    });
    const r = await runSubagent(['spawn-many', '--task', 'a:t']);
    expect(r.exitCode).toBe(0);
    expect(subagentMocks.spawnManyInternal).toHaveBeenCalledTimes(1);
    expect(subagentMocks.spawnSingleInternal).not.toHaveBeenCalled();
  });

  it('subagent help 文本提到 recursion 与 MAX_PARALLEL_TASKS', () => {
    const cmd = appCommands.get('subagent');
    expect(cmd!.help).toContain('recursion');
    expect(cmd!.help).toContain('MAX_PARALLEL_TASKS');
  });

  it('subagent help 文本含 examples 段(同时覆盖 spawn 与 spawn-many)', () => {
    const cmd = appCommands.get('subagent');
    expect(cmd!.help).toContain('EXAMPLES');
    expect(cmd!.help).toMatch(/subagent\s+spawn\b/);
    expect(cmd!.help).toMatch(/subagent\s+spawn-many/);
  });

  it('subagent help 文本同时列出 --task 与 --config-json', () => {
    const cmd = appCommands.get('subagent');
    expect(cmd!.help).toContain('--task');
    expect(cmd!.help).toContain('--config-json');
  });

  it('subagent help 文本声明 spawn-many --config-json 的字段形态', () => {
    const cmd = appCommands.get('subagent');
    expect(cmd!.help).toMatch(/shareContext/);
  });
});
