/**
 * `skill uninstall` subcommand 测试 —— 破坏性默认拒绝是核心契约。
 * 一次卸多个 skill 是 positional 列表(与 mcp/agent remove 单 name 不同)。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSkillMocks, runSkill, skillMocks } from './_fixture';

beforeEach(() => {
  resetSkillMocks();
});

describe('skill uninstall', () => {
  it('缺位置参数 → exit 2', async () => {
    const r = await runSkill('uninstall');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('missing required <name>');
    expect(skillMocks.uninstallSkillInternal).not.toHaveBeenCalled();
  });

  it('不带 --yes → exit 1 + REFUSE + 不调 kernel', async () => {
    skillMocks.profileSkillsItems.mockReturnValue([
      { name: 'pptx', description: 'd', version: '1.0' },
    ]);

    const r = await runSkill('uninstall pptx');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('refusing without --yes');
    expect(r.stderr).toContain('Re-run with --yes');
    expect(skillMocks.uninstallSkillInternal).not.toHaveBeenCalled();
  });

  it('--yes 成功 → 调 kernel,human 输出包含 uninstalled / skipped', async () => {
    skillMocks.uninstallSkillInternal.mockResolvedValue({
      success: true,
      message: 'Uninstalled 1 skill from the current profile. Agent skill references were not changed.',
      uninstalled_count: 1,
      uninstalled_skills: ['pptx'],
      skipped_skills: [{ skill_name: 'foo', reason: 'NOT_INSTALLED' }],
    });

    const r = await runSkill('uninstall pptx foo --yes');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.uninstallSkillInternal).toHaveBeenCalledWith(
      { skill_names: ['pptx', 'foo'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(r.stdout).toContain('Uninstalled 1 skill');
    expect(r.stdout).toContain('uninstalled: pptx');
    expect(r.stdout).toContain('skipped:');
    expect(r.stdout).toContain('foo (NOT_INSTALLED)');
  });

  it('--yes 但 kernel 失败 → exit 1 + 透传 message', async () => {
    skillMocks.uninstallSkillInternal.mockResolvedValue({
      success: false,
      message: 'No skills were uninstalled from the current profile.',
      uninstalled_count: 0,
      uninstalled_skills: [],
      skipped_skills: [{ skill_name: 'pptx', reason: 'DELETE_FAILED' }],
      error: 'NO_SKILLS_UNINSTALLED',
    });

    const r = await runSkill('uninstall pptx --yes');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('No skills were uninstalled');
  });

  it('--dry-run 不需要 --yes;listed installed 显示 would remove', async () => {
    skillMocks.profileSkillsItems.mockReturnValue([
      { name: 'pptx', description: 'd', version: '1' },
    ]);

    const r = await runSkill('uninstall pptx foo --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('would remove: pptx');
    expect(r.stdout).toContain('not installed: foo');
    expect(skillMocks.uninstallSkillInternal).not.toHaveBeenCalled();
  });

  it('--dry-run 全部不存在 → "Nothing would be removed"', async () => {
    const r = await runSkill('uninstall foo bar --dry-run');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Nothing would be removed');
  });

  it('--dry-run --json 输出结构化', async () => {
    skillMocks.profileSkillsItems.mockReturnValue([
      { name: 'pptx', description: 'd', version: '1' },
    ]);

    const r = await runSkill('uninstall pptx foo --dry-run --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj).toMatchObject({
      dryRun: true,
      action: 'uninstall',
      wouldRemove: ['pptx'],
      wouldSkip: ['foo'],
    });
  });

  it('--yes --json 成功 → 透传 kernel envelope', async () => {
    skillMocks.uninstallSkillInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      uninstalled_count: 1,
      uninstalled_skills: ['pptx'],
      skipped_skills: [],
    });

    const r = await runSkill('uninstall pptx --yes --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.success).toBe(true);
    expect(obj.uninstalled_skills).toEqual(['pptx']);
  });
});
