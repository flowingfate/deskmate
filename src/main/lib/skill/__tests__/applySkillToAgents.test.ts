import type { Mock } from 'vitest';
import { applySkillToAgents } from '../applySkillToAgents';
import type { SkillBindings } from '@shared/types/profileTypes';

const mockActive = vi.fn();

vi.mock('../../../persist', () => ({
  Profiles: { get: () => ({ active: () => mockActive() }) },
}));

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

function makeAgent(id: string, name: string, skills: SkillBindings): TestAgent {
  const config: TestAgentConfig = { name, skills };
  // Mirror the real Agent.patchFront: assign the diff to config, then persist.
  // Source applySkillToAgents only awaits agent.patchFront() and relies on its
  // internal persist call for durability.
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

describe('applySkillToAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies a skill to matching targets', async () => {
    const a1 = makeAgent('chat-1', 'Deck Builder', {});
    const a2 = makeAgent('chat-2', 'Designer', {});
    const a3 = makeAgent('chat-3', 'Reviewer', { pptx: 'live' });

    const agentsById: Record<string, TestAgent> = { 'chat-1': a1, 'chat-2': a2, 'chat-3': a3 };
    mockActive.mockResolvedValue({
      skills: {
        get: (n: string) => (n === 'pptx' ? { name: 'pptx' } : undefined),
      },
      listAgents: () => [
        { id: 'chat-1' }, { id: 'chat-2' }, { id: 'chat-3' },
      ],
      getAgent: async (id: string) => agentsById[id],
    });

    const result = await applySkillToAgents({
      skillName: 'pptx',
      targets: [
        { agentId: 'chat-1', agentName: 'Deck Builder' },
        { agentId: 'chat-2', agentName: 'Designer' },
        { agentId: 'chat-3', agentName: 'Reviewer' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.appliedCount).toBe(2);
    expect(result.alreadyAppliedCount).toBe(1);
    expect(a1.patchFront).toHaveBeenCalledWith({ skills: { pptx: 'live' } });
    expect(a1.persist).toHaveBeenCalled();
    expect(a2.patchFront).toHaveBeenCalledWith({ skills: { pptx: 'live' } });
    expect(a2.persist).toHaveBeenCalled();
    expect(a3.patchFront).not.toHaveBeenCalled();
  });
});
