/**
 * `skill install` subcommand 测试 —— 仅 device-path 安装(远程 clawhub/github
 * 已整体移除,不再有 --from 参数)+ path 校验 + dry-run / json 输出。
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

  it('传 --from → exit 2(unknown flag,参数已整体移除)', async () => {
    const r = await runSkill('install foo --from bogus --path /tmp/foo');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown flag: --from');
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
  });

  it('缺 --path → exit 2', async () => {
    const r = await runSkill('install foo');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('--path is required');
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
  });

  it('--path 走 device-path', async () => {
    skillMocks.installSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      skill_name: 'foo',
    });

    const r = await runSkill('install foo --path /tmp/foo.zip');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.installSkillInternal).toHaveBeenCalledWith(
      { skill_name: 'foo', path: '/tmp/foo.zip' },
      expect.anything(),
    );
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
    });
  });
});
