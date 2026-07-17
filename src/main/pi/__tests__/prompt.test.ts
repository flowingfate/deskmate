import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillRecord } from '@shared/persist/types';
import type { AgentConfig } from '../utils/config';


// 屏蔽 globalSystemPrompt 真实文本；测试只关心拼接结构
vi.mock('../utils/globalSystemPrompt', () => ({
  getGlobalSystemPrompt: () => '<<GLOBAL_PROMPT>>',
}));



// Profiles 链：mock active() 返回受控 profile 对象
const profile: {
  id: string;
  skills: {
    items: SkillRecord[];
    get: (name: string) => SkillRecord | undefined;
  };
} = {
  id: 'p_active',
  skills: {
    items: [],
    get(name: string) {
      return this.items.find((s) => s.name === name);
    },
  },
};

vi.mock('@main/persist', () => ({
  Profiles: { get: () => ({ active: async () => profile }) },
}));

import { buildSystemPrompt } from '../prompt';

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Otto',
    emoji: '🤖',
    model: 'github-copilot::claude-sonnet-4.6',
    mcpServers: [],
    systemPrompt: '',
    ...overrides,
  };
}

beforeEach(() => {
  profile.id = 'p_active';
  profile.skills.items = [];
});

describe('buildSystemPrompt', () => {
  it('throws when profileId does not match active profile', async () => {
    await expect(
      buildSystemPrompt({ agentCfg: makeAgent(), profileId: 'p_other', agentId: 'a1', sessionId: 's1' }),
    ).rejects.toThrow(/profileId mismatch/);
  });

  it('joins custom prompt + identity + global with --- separators', async () => {
    const out = await buildSystemPrompt({
      agentCfg: makeAgent({ systemPrompt: 'You are helpful.' }),
      profileId: 'p_active',
      agentId: 'a1',
      sessionId: 's1',
    });
    expect(out.startsWith('You are helpful.')).toBe(true);
    expect(out).toContain('Your Identity:');
    expect(out).toContain('**Otto**');
    expect(out).toContain('<<GLOBAL_PROMPT>>');
    // 三段以 \n\n---\n\n 连接
    expect(out.split('\n\n---\n\n').length).toBe(3);
  });

  it('skips custom prompt section when systemPrompt is empty', async () => {
    const out = await buildSystemPrompt({
      agentCfg: makeAgent({ systemPrompt: '' }),
      profileId: 'p_active', agentId: 'a1', sessionId: 's1',
    });
    // identity + global，2 段
    expect(out.split('\n\n---\n\n').length).toBe(2);
  });

  it('always emits knowledge:// URI schema in knowledge block (no absolute path leak)', async () => {
    const out = await buildSystemPrompt({
      agentCfg: makeAgent(),
      profileId: 'p_active', agentId: 'a1', sessionId: 's1',
    });
    expect(out).toContain('Your Knowledge Sources:');
    expect(out).toContain('knowledge://<relative_path>');
    // LLM 视角不暴露 KB 绝对路径 —— scheme 屏蔽布局。
    expect(out).not.toContain('/test-root/profiles/p_active/agents/a1/knowledge');
  });

  it('renders skills block via `skill://` URI; logs missing names; no profile abs path leak', async () => {
    profile.skills.items = [
      { name: 'web-search', description: 'search', version: '1.0' },
    ];
    const out = await buildSystemPrompt({
      agentCfg: makeAgent({ skills: { 'web-search': 'live', 'missing-one': 'live' } }),
      profileId: 'p_active', agentId: 'a1', sessionId: 's1',
    });
    expect(out).toContain('Skills Instructions:');
    expect(out).toContain('web-search');
    expect(out).toContain('skill://web-search');
    // profile 绝对路径不出现在 LLM-visible prompt。
    expect(out).not.toContain('/test-root/profiles/p_active/skills');
    // missing 不出现在 prompt 里
    expect(out).not.toContain('missing-one');
  });

  it('omits skills block when agent has no skills', async () => {
    const out = await buildSystemPrompt({
      agentCfg: makeAgent({ skills: {} }),
      profileId: 'p_active', agentId: 'a1', sessionId: 's1',
    });
    expect(out).not.toContain('Skills Instructions:');
  });

  it('does not list lazy skill metadata but supplies stable read guidance', async () => {
    profile.skills.items = [
      { name: 'pdf', description: 'pdf tools', version: '1.0' },
    ];
    const out = await buildSystemPrompt({
      agentCfg: makeAgent({ skills: { pdf: 'lazy' } }),
      profileId: 'p_active', agentId: 'a1', sessionId: 's1',
    });
    expect(out).toContain('Skills Instructions:');
    expect(out).toContain('The user may explicitly reference a lazy skill');
    expect(out).toContain('MUST call `read skill://<name>`');
    expect(out).not.toContain('**pdf**');
    expect(out).not.toContain('Description: pdf tools');
  });

  it('lists live metadata but not lazy metadata', async () => {
    profile.skills.items = [
      { name: 'web-search', description: 'search', version: '1.0' },
      { name: 'pdf', description: 'pdf', version: '2.0' },
    ];
    const out = await buildSystemPrompt({
      agentCfg: makeAgent({ skills: { 'web-search': 'live', pdf: 'lazy' } }),
      profileId: 'p_active', agentId: 'a1', sessionId: 's1',
    });
    expect(out).toContain('skill://web-search');
    expect(out).not.toContain('**pdf**');
    expect(out).not.toContain('Description: pdf');
  });

});


