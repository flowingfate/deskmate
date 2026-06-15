import { Profiles } from '../../persist';

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

export async function getSkillAvailability(args: SkillAvailabilityArgs): Promise<SkillAvailabilityResult> {
  const skillName = args.skillName.trim();

  let profile;
  try {
    profile = await Profiles.get().active();
  } catch {
    profile = null;
  }
  const installed = !!profile?.skills.items.some((s: { name: string }) => s.name === skillName);

  if (!args.agentId || !profile) {
    return {
      skillName,
      installed,
      appliedToCurrentAgent: false,
      callableInCurrentChat: false,
    };
  }

  const agent = await profile.getAgent(args.agentId);
  if (!agent) {
    return {
      skillName,
      installed,
      appliedToCurrentAgent: false,
      callableInCurrentChat: false,
      reason: 'CHAT_NOT_FOUND',
    };
  }

  const appliedToCurrentAgent = (agent.config.skills || []).includes(skillName);
  return {
    skillName,
    installed,
    appliedToCurrentAgent,
    callableInCurrentChat: installed && appliedToCurrentAgent,
    currentAgentName: agent.config.name,
  };
}
