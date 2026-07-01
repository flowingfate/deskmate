/**
 * `skill search` subcommand 测试 —— 跨 3 源（installed / clawhub / github）搜 +
 * --installed 切换 + --json 透传 + 错误路径。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { resetSkillMocks, runSkill, skillMocks } from './_fixture';

beforeEach(() => {
  resetSkillMocks();
});

describe('skill search — 跨 3 源', () => {
  it('缺 <query> 且无 --installed → exit 2', async () => {
    const r = await runSkill('search');
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('missing <query>');
    expect(skillMocks.searchLibraryInternal).not.toHaveBeenCalled();
    expect(skillMocks.listSkillsInternal).not.toHaveBeenCalled();
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
          source: 'clawhub',
          metadata: { name: 'pdf', description: 'PDF tools', version: '1.0' },
        },
      ],
      total_count: 1,
    });

    const r = await runSkill('search pdf');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.searchLibraryInternal).toHaveBeenCalledWith({
      query: 'pdf',
      current_agent_id: 'agent-test',
    });
    expect(r.stdout).toContain('[clawhub] pdf v1.0');
    expect(r.stdout).toContain('PDF tools');
  });

  it('命中 + clawhub 源 → 输出 local_folder', async () => {
    skillMocks.searchLibraryInternal.mockResolvedValue({
      success: true,
      message: 'ok',
      results: [
        {
          source: 'clawhub',
          metadata: {
            name: 'awesome',
            description: 'd',
            version: '0.1',
            local_folder: '/tmp/cache/awesome',
            score: 0.9,
          },
        },
      ],
      total_count: 1,
    });

    const r = await runSkill('search awesome');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[clawhub] awesome v0.1');
    expect(r.stdout).toContain('local_folder: /tmp/cache/awesome');
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
          source: 'clawhub',
          metadata: { name: 'pdf', description: 'd', version: '1' },
        },
      ],
      total_count: 1,
      warnings: ['GitHub repo search failed: timeout'],
    });

    const r = await runSkill('search pdf');
    expect(r.stdout).toContain('Warnings:');
    expect(r.stdout).toContain('GitHub repo search failed: timeout');
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
});

describe('skill search --installed', () => {
  it('--installed 不调 searchLibrary,只调 listSkills', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [
        { name: 'pptx', description: 'd1', version: '1' },
        { name: 'pdf', description: 'd2', version: '2' },
      ],
      count: 2,
      message: 'Found 2 installed skill(s).',
    });

    const r = await runSkill('search --installed');
    expect(r.exitCode).toBe(0);
    expect(skillMocks.searchLibraryInternal).not.toHaveBeenCalled();
    expect(r.stdout).toContain('Installed skills (2)');
    expect(r.stdout).toContain('pptx');
    expect(r.stdout).toContain('pdf');
  });

  it('--installed 带 query → 过滤命中', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [
        { name: 'pptx', description: 'pptx tool', version: '1' },
        { name: 'pdf', description: 'pdf tool', version: '2' },
      ],
      count: 2,
      message: 'ok',
    });

    const r = await runSkill('search --installed pdf');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Installed skills (1)');
    expect(r.stdout).toContain('pdf');
    expect(r.stdout).not.toMatch(/\bpptx\b/);
  });

  it('--installed 0 命中 → 提示 No installed skills match', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [
        { name: 'pptx', description: 'd', version: '1' },
      ],
      count: 1,
      message: 'ok',
    });

    const r = await runSkill('search --installed xyz');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No installed skills match "xyz"');
  });

  it('--installed 空集 → No skills installed', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [],
      count: 0,
      message: 'ok',
    });

    const r = await runSkill('search --installed');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No skills installed');
  });

  it('--installed --json 输出结构化', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: true,
      skills: [
        { name: 'pptx', description: 'd', version: '1' },
      ],
      count: 1,
      message: 'ok',
    });

    const r = await runSkill('search --installed --json');
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.source).toBe('installed');
    expect(obj.count).toBe(1);
  });

  it('--installed kernel 失败 → exit 1', async () => {
    skillMocks.listSkillsInternal.mockResolvedValue({
      success: false,
      skills: [],
      count: 0,
      message: 'Error listing skills',
      error: 'LIST_FAILED',
    });

    const r = await runSkill('search --installed');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Error listing skills');
  });
});
