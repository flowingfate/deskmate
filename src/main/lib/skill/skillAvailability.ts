import type { ProfileStore } from '@main/persist';

export interface SkillAvailabilityArgs {
  skillName: string;
  agentId?: string;
  agentName?: string;
}

export interface SkillAvailabilityResult {
  skillName: string;
  installed: boolean;
  appliedToCurrentAgent: boolean;
  callableInCurrentChat: boolean;
  currentAgentName?: string;
  reason?: 'CHAT_NOT_FOUND' | 'AGENT_NOT_RESOLVED';
}

export async function getSkillAvailability(
  store: ProfileStore,
  args: SkillAvailabilityArgs,
): Promise<SkillAvailabilityResult> {
  const skillName = args.skillName.trim();
  const installed = store.skills.items.some((skill) => skill.name === skillName);

  if (!args.agentId) {
    return {
      skillName,
      installed,
      appliedToCurrentAgent: false,
      callableInCurrentChat: false,
    };
  }

  const agent = await store.getAgent(args.agentId);
  if (!agent) {
    return {
      skillName,
      installed,
      appliedToCurrentAgent: false,
      callableInCurrentChat: false,
      reason: 'CHAT_NOT_FOUND',
    };
  }

  const appliedToCurrentAgent = (agent.config.skills ?? {})[skillName] !== undefined;
  return {
    skillName,
    installed,
    appliedToCurrentAgent,
    callableInCurrentChat: installed && appliedToCurrentAgent,
    currentAgentName: agent.config.name,
  };
}
