import type { Mock } from 'vitest';
import { removeSkillsFromAgents } from '../removeSkillsFromAgents';
import type { SkillBindings } from '@shared/persist/types'

const mockActive = vi.fn();


interface TestAgentConfig {
  name: string;
  skills: SkillBindings;
}
interface TestAgent {
  id: string;
  config: TestAgentConfig;
  patchFront: Mock;
  persist: Mock;
}

/** 从档位 map 或名字数组（默认 live 档）构造 skills 映射，方便测试书写。 */
function toBindings(skills: SkillBindings | string[]): SkillBindings {
  if (Array.isArray(skills)) {
    return Object.fromEntries(skills.map((n) => [n, 'live' as const]));
  }
  return skills;
}

function makeAgent(id: string, name: string, skills: SkillBindings | string[]): TestAgent {
  const config: TestAgentConfig = { name, skills: toBindings(skills) };
  // Mirror the real Agent.patchFront: assign the diff to config, then persist.
  // Source removeSkillsFromAgents only awaits agent.patchFront() and relies on
  // its internal persist call for durability.
  const agent: TestAgent = {
    id,
    config,
    patchFront: vi.fn(async (p: Partial<TestAgentConfig>) => {
      Object.assign(config, p);
      await agent.persist();
    }),
    persist: vi.fn(async () => undefined),
  };
  return agent;
}

function buildProfile(agents: TestAgent[]) {
  const byId: Record<string, TestAgent> = Object.fromEntries(agents.map((a) => [a.id, a]));
  return {
    listAgents: () => agents.map((a) => ({ id: a.id })),
    getAgent: async (id: string) => byId[id],
  };
}

describe('removeSkillsFromAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes matching skills from resolved agents', async () => {
    const a1 = makeAgent('chat-1', 'Deck Builder', ['pptx', 'figma']);
    const a2 = makeAgent('chat-2', 'Designer', ['pptx', 'jira']);
    const a3 = makeAgent('chat-3', 'Reviewer', ['jira']);
    mockActive.mockResolvedValue(buildProfile([a1, a2, a3]));

    const result = await removeSkillsFromAgents(await mockActive(), {
      skillNames: ['pptx', 'jira'],
      targets: [
        { agentId: 'chat-1', agentName: 'Deck Builder' },
        { agentId: 'chat-2', agentName: 'Designer' },
        { agentId: 'chat-3', agentName: 'Reviewer' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.updatedAgentCount).toBe(3);
    expect(result.removedBindingCount).toBe(4);
    // 保留未删除的档位（figma 仍为 live）；全删则为空 map。
    expect(a1.patchFront).toHaveBeenCalledWith({ skills: { figma: 'live' } });
    expect(a2.patchFront).toHaveBeenCalledWith({ skills: {} });
    expect(a3.patchFront).toHaveBeenCalledWith({ skills: {} });
  });

  it('reports unchanged targets when none of the requested skills are applied', async () => {
    const a1 = makeAgent('chat-1', 'Deck Builder', ['figma']);
    mockActive.mockResolvedValue(buildProfile([a1]));

    const result = await removeSkillsFromAgents(await mockActive(), {
      skillNames: ['pptx'],
      targets: [{ agentId: 'chat-1', agentName: 'Deck Builder' }],
    });

    expect(result.success).toBe(false);
    expect(result.updatedAgentCount).toBe(0);
    expect(result.unchangedTargetCount).toBe(1);
    expect(result.skippedTargets).toEqual([
      { agentId: 'chat-1', agentName: 'Deck Builder', reason: 'SKILLS_NOT_APPLIED' },
    ]);
    expect(a1.persist).not.toHaveBeenCalled();
  });

  it('can remove stale skill names even when they are not globally installed', async () => {
    const a1 = makeAgent('chat-1', 'Deck Builder', ['legacy-skill']);
    mockActive.mockResolvedValue(buildProfile([a1]));

    const result = await removeSkillsFromAgents(await mockActive(), {
      skillNames: ['legacy-skill'],
      targets: [{ agentId: 'chat-1', agentName: 'Deck Builder' }],
    });

    expect(result.success).toBe(true);
    expect(result.removedBindingCount).toBe(1);
    expect(a1.patchFront).toHaveBeenCalledWith({ skills: {} });
    expect(a1.persist).toHaveBeenCalled();
  });

  it('preserves the tier of a skill that is not being removed (lazy stays lazy)', async () => {
    const a1 = makeAgent('chat-1', 'Deck Builder', { pptx: 'live', pdf: 'lazy' });
    mockActive.mockResolvedValue(buildProfile([a1]));

    const result = await removeSkillsFromAgents(await mockActive(), {
      skillNames: ['pptx'],
      targets: [{ agentId: 'chat-1', agentName: 'Deck Builder' }],
    });

    expect(result.success).toBe(true);
    expect(a1.patchFront).toHaveBeenCalledWith({ skills: { pdf: 'lazy' } });
  });
});
