/**
 * `skill search` subcommand 测试 —— 仅本地 installed 源,要求关键字
 * (`--installed` flag 已整体移除,零 query 场景改用 `skill list`)+
 * --json 透传 + 错误路径。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSkillMocks, runSkill, skillMocks } from './_fixture';

beforeEach(() => {
  resetSkillMocks();
});

describe('skill search', () => {
  it('缺 <query> → exit 2', async () => {
    const r = await runSkill('search');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('missing <query>');
    expect(skillMocks.searchLibraryInternal).not.toHaveBeenCalled();
  });

  it('多余位置参数 → exit 2 + 提示加引号', async () => {
    const r = await runSkill('search foo bar baz');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('too many positional');
    expect(r.stderr).toContain('Quote queries');
  });

  it('调 kernel 传 query + current_agent_id', async () => {
    skillMocks.searchLibraryInternal.mockResolvedValue({
      success: true,
      message: 'Found 1 skill(s) matching "pdf".',
      results: [
        {
          source: 'installed',
          metadata: { name: 'pdf', description: 'PDF tools', version: '1.0' },
        },
      ],
      total_count: 1,
    });

    const r = await runSkill('search pdf');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.searchLibraryInternal).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
      {
        query: 'pdf',
        current_agent_id: 'agent-test',
      },
    );
    expect(r.stdout).toContain('pdf v1.0');
    expect(r.stdout).toContain('PDF tools');
  });

  it('applied_to_current_agent 字段被透到 human 输出', async () => {
    skillMocks.searchLibraryInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      results: [
        {
          source: 'installed',
          metadata: {
            name: 'awesome',
            description: 'd',
            version: '0.1',
            applied_to_current_agent: true,
          },
        },
      ],
      total_count: 1,
    });

    const r = await runSkill('search awesome');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('awesome v0.1');
    expect(r.stdout).toContain('applied_to_current_agent: yes');
  });

  it('0 results → 输出 kernel 的 message', async () => {
    skillMocks.searchLibraryInternal.mockResolvedValue({
      success: true,
      message: 'No skills found matching "xyz".',
      results: [],
      total_count: 0,
    });

    const r = await runSkill('search xyz');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No skills found matching "xyz"');
  });

  it('warnings 字段被透到 human 输出', async () => {
    skillMocks.searchLibraryInternal.mockResolvedValue({
      success: true,
      message: 'Found 1 skill(s) matching "pdf".',
      results: [
        {
          source: 'installed',
          metadata: { name: 'pdf', description: 'd', version: '1' },
        },
      ],
      total_count: 1,
      warnings: ['Installed skills check failed: getAgent timeout'],
    });

    const r = await runSkill('search pdf');
    expect(r.stdout).toContain('Warnings:');
    expect(r.stdout).toContain('Installed skills check failed: getAgent timeout');
  });

  it('kernel 失败 → exit 1 + stderr', async () => {
    skillMocks.searchLibraryInternal.mockResolvedValue({
      success: false,
      message: 'Invalid input: query is required',
      results: [],
      total_count: 0,
      error: 'INVALID_INPUT',
    });

    const r = await runSkill('search foo');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Invalid input');
  });

  it('--json 透传 raw envelope', async () => {
    skillMocks.searchLibraryInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      results: [],
      total_count: 0,
    });

    const r = await runSkill('search foo --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.success).toBe(true);
    expect(obj.total_count).toBe(0);
  });

  it('--installed 已随 flag 一并移除 → unknown flag 报错', async () => {
    const r = await runSkill('search --installed');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('unknown flag: --installed');
    expect(skillMocks.searchLibraryInternal).not.toHaveBeenCalled();
    expect(skillMocks.listSkillsInternal).not.toHaveBeenCalled();
  });
});
