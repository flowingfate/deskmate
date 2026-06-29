/**
 * `skill` 顶层路由 + `--help` / 未知 subcommand 行为 + list / status 的 minimal
 * happy path 测试。形态与 `agent/router.test.ts` 对齐。
 */

import { beforeEach, describe, expect, it } from 'vitest';


import { resetSkillMocks, runSkill, skillMocks } from './_fixture';
import { appCommands } from '@main/pi/appcmd/builtins/app';

beforeEach(() => {
  resetSkillMocks();
});

describe('skill 顶层路由', () => {
  it('注册到全局 appCommands', () => {
    expect(appCommands.has('skill')).toBe(true);
  });

  it('空 sub → 顶层 help,exit 0', async () => {
    const r = await runSkill('');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(r.stdout).toContain('SUBCOMMANDS');
    expect(r.stdout).toContain('install');
    expect(r.stdout).toContain('uninstall');
    expect(r.stdout).toContain('bind');
  });

  it('`skill --help` → 顶层 help', async () => {
    const r = await runSkill('--help');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
  });

  it('`skill -h` → 顶层 help', async () => {
    const r = await runSkill('-h');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
  });

  it('未知 subcommand → exit 2 + hint', async () => {
    const r = await runSkill('bogus');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown subcommand "bogus"');
    expect(r.stderr).toContain('skill --help');
  });

  it.each([
    'install',
    'uninstall',
    'bind',
    'unbind',
    'list',
    'status',
    'search',
  ])('`skill %s --help` 展示 subcommand help,exit 0,不动 kernel', async (sub) => {
    const r = await runSkill(`${sub} --help`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('USAGE');
    expect(skillMocks.installSkillInternal).not.toHaveBeenCalled();
    expect(skillMocks.uninstallSkillInternal).not.toHaveBeenCalled();
    expect(skillMocks.bindSkillInternal).not.toHaveBeenCalled();
    expect(skillMocks.unbindSkillInternal).not.toHaveBeenCalled();
    expect(skillMocks.listSkillsInternal).not.toHaveBeenCalled();
    expect(skillMocks.getSkillStatusInternal).not.toHaveBeenCalled();
    expect(skillMocks.searchLibraryInternal).not.toHaveBeenCalled();
  });
});

describe('skill list', () => {
  it('happy path: 调 kernel,人话输出', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [
        { name: 'pptx', description: 'pptx tool', version: '1' },
      ],
      count: 1,
      message: 'ok',
    });

    const r = await runSkill('list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('1 skill(s)');
    expect(r.stdout).toContain('pptx');
  });

  it('多余位置参数 → exit 2', async () => {
    const r = await runSkill('list foo');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('takes no positional');
    expect(skillMocks.listSkillsInternal).not.toHaveBeenCalled();
  });

  it('空集 → No skills installed', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [],
      count: 0,
      message: 'ok',
    });

    const r = await runSkill('list');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No skills installed');
  });

  it('kernel 失败 → exit 1', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: false,
      skills: [],
      count: 0,
      message: 'broken',
      error: 'LIST_FAILED',
    });

    const r = await runSkill('list');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('broken');
  });

  it('--json 输出', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [],
      count: 0,
      message: 'ok',
    });

    const r = await runSkill('list --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.success).toBe(true);
  });
});

describe('skill status', () => {
  it('缺 <name> → exit 2', async () => {
    const r = await runSkill('status');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('expected exactly one positional');
    expect(skillMocks.getSkillStatusInternal).not.toHaveBeenCalled();
  });

  it('NotInstalled → human 输出 status 行', async () => {
    skillMocks.getSkillStatusInternal.mockResolvedValue({
      success: true,
      skill_name: 'pptx',
      status: 'NotInstalled',
      message: 'not installed',
    });

    const r = await runSkill('status pptx');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('skill status "pptx": NotInstalled');
  });

  it('Installed + 详情 → 输出 details', async () => {
    skillMocks.getSkillStatusInternal.mockResolvedValue({
      success: true,
      skill_name: 'pptx',
      status: 'Installed',
      message: 'ok',
      details: {
        version: '1.0',
        
        description: 'pptx tool',
        applied_to_current_agent: true,
      },
    });

    const r = await runSkill('status pptx');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Installed');
    expect(r.stdout).toContain('version: 1.0');
    expect(r.stdout).toContain('desc:    pptx tool');
    expect(r.stdout).toContain('applied_to_current_agent: yes');
  });

  it('current_agent_id 透传 ctx.agentId', async () => {
    skillMocks.getSkillStatusInternal.mockResolvedValue({
      success: true,
      skill_name: 'pptx',
      status: 'NotInstalled',
      message: 'ok',
    });

    await runSkill('status pptx');
    expect(skillMocks.getSkillStatusInternal).toHaveBeenCalledWith(
      { skill_name: 'pptx', current_agent_id: 'agent-test' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('kernel 失败 → exit 1', async () => {
    skillMocks.getSkillStatusInternal.mockResolvedValue({
      success: false,
      skill_name: 'pptx',
      status: 'NotInstalled',
      message: 'boom',
      error: 'STATUS_FAILED',
    });

    const r = await runSkill('status pptx');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('boom');
  });

  it('--json 透传', async () => {
    skillMocks.getSkillStatusInternal.mockResolvedValue({
      success: true,
      skill_name: 'pptx',
      status: 'NotInstalled',
      message: 'ok',
    });

    const r = await runSkill('status pptx --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.skill_name).toBe('pptx');
    expect(obj.status).toBe('NotInstalled');
  });
});
