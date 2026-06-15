/**
 * `skill install` subcommand 测试 —— 3 个 source 路径 (device / clawhub / github)
 * + path 校验 + dry-run / json 输出。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSkillMocks, runSkill, skillMocks } from './_fixture';

beforeEach(() => {
  resetSkillMocks();
});

describe('skill install', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runSkill('install');
    expect(r.exitCode).toBe(2);
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
  });

  it('多余位置参数 → exit 2', async () => {
    const r = await runSkill('install foo bar');
    expect(r.exitCode).toBe(2);
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
  });

  it('--from 非法值 → exit 2 + 列出合法值', async () => {
    const r = await runSkill('install foo --from bogus --path /tmp/foo');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('invalid --from "bogus"');
    expect(r.stderr).toContain('device, clawhub, github');
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
  });

  it('default --from=device 缺 --path → exit 2', async () => {
    const r = await runSkill('install foo');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--path is required');
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
  });

  it('--from github 缺 --path → exit 2', async () => {
    const r = await runSkill('install foo --from github');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--path is required');
  });

  it('--from device --path 走 device-path', async () => {
    skillMocks.installSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'foo',
    });

    const r = await runSkill('install foo --from device --path /tmp/foo.zip');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.installSkillInternal).toHaveBeenCalledWith(
      { skill_name: 'foo', path: '/tmp/foo.zip' },
      expect.anything(),
    );
  });

  it('--from clawhub --path 走 device-path(human output 显示 clawhub)', async () => {
    skillMocks.installSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'foo',
    });

    const r = await runSkill('install foo --from clawhub --path /tmp/clawhub/foo');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.installSkillInternal).toHaveBeenCalledWith(
      { skill_name: 'foo', path: '/tmp/clawhub/foo' },
      expect.anything(),
    );
    expect(r.stdout).toContain('from clawhub');
  });

  it('--dry-run 不调 kernel,人话输出', async () => {
    const r = await runSkill('install foo --path /tmp/foo --dry-run');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
    expect(r.stdout).toContain('[dry-run] skill install "foo"');
    expect(r.stdout).toContain('Nothing was written');
  });

  it('--dry-run --json 输出结构化', async () => {
    const r = await runSkill('install foo --path /tmp/foo --dry-run --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj).toMatchObject({
      dryRun: true,
      action: 'install',
      skill_name: 'foo',
      from: 'device',
      path: '/tmp/foo',
    });
  });

  it('kernel 失败 → exit 1 + stderr 透传 message', async () => {
    skillMocks.installSkillInternal.mockResolvedValue({
      success: false,
      message: 'Network error',
      skill_name: 'foo',
      error: 'INSTALL_FAILED',
    });

    const r = await runSkill('install foo --path /tmp/foo');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Network error');
  });

  it('--json 成功 → 输出 success envelope', async () => {
    skillMocks.installSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'foo',
    });

    const r = await runSkill('install foo --path /tmp/foo --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj).toMatchObject({
      success: true,
      action: 'install',
      skill_name: 'foo',
      from: 'device',
    });
  });
});
