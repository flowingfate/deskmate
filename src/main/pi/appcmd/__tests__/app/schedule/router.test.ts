/**
 * `schedule` 顶层路由 + `--help` / 未知 subcommand + 各 subcommand `--help`
 * 不调 kernel 的最少 happy path 测试。
 *
 * 与 `__tests__/mcp/router.test.ts` 同纪律 —— "路由层"测试集中在一个文件,
 * 避免散布到各 subcommand 测试文件里。
 */

import { beforeEach, describe, expect, it } from 'vitest';


import { resetScheduleMocks, runSchedule, scheduleMocks } from './_fixture';
import { appCommands } from '@main/pi/appcmd/builtins/app';

beforeEach(() => {
  resetScheduleMocks();
});

describe('schedule 顶层路由', () => {
  it('注册到全局 appCommands', () => {
    expect(appCommands.has('schedule')).toBe(true);
  });

  it('空 sub → 顶层 help,exit 0', async () => {
    const r = await runSchedule('');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('schedule <subcommand>');
    expect(scheduleMocks.listJobsInternal).not.toHaveBeenCalled();
  });

  it('`schedule --help` → 顶层 help', async () => {
    const r = await runSchedule('--help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('schedule <subcommand>');
  });

  it('`schedule -h` → 顶层 help', async () => {
    const r = await runSchedule('-h');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('schedule <subcommand>');
  });

  it('未知 subcommand → exit 2 + hint', async () => {
    const r = await runSchedule('bogus-sub');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown subcommand "bogus-sub"');
    expect(r.stderr).toContain('schedule --help');
  });

  it.each([
    ['create'],
    ['list'],
    ['update'],
    ['remove'],
    ['run'],
  ])('`schedule %s --help` 展示 subcommand help,exit 0,不动 kernel', async (sub) => {
    const r = await runSchedule(`${sub} --help`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout.toLowerCase()).toContain(sub);
    expect(scheduleMocks.createJobInternal).not.toHaveBeenCalled();
    expect(scheduleMocks.listJobsInternal).not.toHaveBeenCalled();
    expect(scheduleMocks.updateJobInternal).not.toHaveBeenCalled();
    expect(scheduleMocks.deleteJobInternal).not.toHaveBeenCalled();
    expect(scheduleMocks.runJobNowInternal).not.toHaveBeenCalled();
  });
});
