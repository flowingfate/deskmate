import { log } from '@main/log';
import { Profiles } from '../../persist';
import type { Agent } from '../../persist/agent';
import type { SkillBindings } from '@shared/persist/types'

const logger = log;

export interface SkillAgentTarget {
  agentId: string;
  agentName: string;
}

export interface RemoveSkillsFromAgentsOptions {
  skillNames: string[];
  targets?: SkillAgentTarget[];
  agentIds?: string[];
  agentNames?: string[];
  removeFromAll?: boolean;
}

export interface RemoveSkillsFromAgentsResult {
  success: boolean;
  skillNames: string[];
  message: string;
  updatedAgentCount: number;
  removedBindingCount: number;
  unchangedTargetCount: number;
  failedCount: number;
  updatedTargets: Array<SkillAgentTarget & { removedSkills: string[] }>;
  skippedTargets: Array<SkillAgentTarget & { reason: string }>;
  error?: string;
}

function normalizeStringArray(values?: string[]): string[] {
  return Array.from(new Set((values || []).map(value => value?.trim()).filter((value): value is string => !!value)));
}

function targetKey(target: SkillAgentTarget): string {
  return `${target.agentId}::${target.agentName}`;
}

function resolveTargets(agents: Agent[], options: RemoveSkillsFromAgentsOptions): SkillAgentTarget[] {
  if (options.targets && options.targets.length > 0) {
    return Array.from(
      new Map(
        options.targets
          .filter(target => target.agentId?.trim() && target.agentName?.trim())
          .map(target => [targetKey({ agentId: target.agentId.trim(), agentName: target.agentName.trim() }), {
            agentId: target.agentId.trim(),
            agentName: target.agentName.trim(),
          }]),
      ).values(),
    );
  }

  const agentIds = new Set(normalizeStringArray(options.agentIds));
  const agentNames = new Set(normalizeStringArray(options.agentNames));
  const shouldRemoveFromAll = options.removeFromAll === true;

  if (!shouldRemoveFromAll && agentIds.size === 0 && agentNames.size === 0) {
    return [];
  }

  const resolved: SkillAgentTarget[] = [];
  for (const agent of agents) {
    if (!shouldRemoveFromAll && agentIds.size > 0 && !agentIds.has(agent.id)) {
      continue;
    }
    if (!shouldRemoveFromAll && agentNames.size > 0 && !agentNames.has(agent.config.name)) {
      continue;
    }
    resolved.push({ agentId: agent.id, agentName: agent.config.name });
  }

  return Array.from(new Map(resolved.map(target => [targetKey(target), target])).values());
}

export async function removeSkillsFromAgents(
  options: RemoveSkillsFromAgentsOptions,
): Promise<RemoveSkillsFromAgentsResult> {
  const skillNames = normalizeStringArray(options.skillNames);
  if (skillNames.length === 0) {
    return {
      success: false,
      skillNames: [],
      message: 'skillNames is required',
      updatedAgentCount: 0,
      removedBindingCount: 0,
      unchangedTargetCount: 0,
      failedCount: 0,
      updatedTargets: [],
      skippedTargets: [],
      error: 'INVALID_INPUT',
    };
  }

  let profile;
  try {
    profile = await Profiles.get().active();
  } catch {
    profile = null;
  }
  if (!profile) {
    return {
      success: false,
      skillNames,
      message: 'User profile not found',
      updatedAgentCount: 0,
      removedBindingCount: 0,
      unchangedTargetCount: 0,
      failedCount: 0,
      updatedTargets: [],
      skippedTargets: [],
      error: 'PROFILE_NOT_FOUND',
    };
  }

  const records = profile.listAgents();
  const allAgents: Agent[] = [];
  for (const rec of records) {
    const a = await profile.getAgent(rec.id);
    if (a) allAgents.push(a);
  }

  const resolvedTargets = resolveTargets(allAgents, { ...options, skillNames });

  if (resolvedTargets.length === 0) {
    return {
      success: false,
      skillNames,
      message: 'No target agents resolved for skill removal.',
      updatedAgentCount: 0,
      removedBindingCount: 0,
      unchangedTargetCount: 0,
      failedCount: 0,
      updatedTargets: [],
      skippedTargets: [],
      error: 'NO_TARGETS',
    };
  }

  const skillNameSet = new Set(skillNames);
  const agentById = new Map(allAgents.map(a => [a.id, a]));
  const skippedTargets: Array<SkillAgentTarget & { reason: string }> = [];
  const updatedTargets: Array<SkillAgentTarget & { removedSkills: string[] }> = [];
  let unchangedTargetCount = 0;
  let failedCount = 0;
  let removedBindingCount = 0;

  for (const target of resolvedTargets) {
    const agent = agentById.get(target.agentId);
    if (!agent) {
      skippedTargets.push({ ...target, reason: 'CHAT_NOT_FOUND' });
      continue;
    }
    if (agent.config.name !== target.agentName) {
      skippedTargets.push({ ...target, reason: 'AGENT_NOT_FOUND' });
      continue;
    }

    const bindings = agent.config.skills ?? {};
    const removedSkills = Object.keys(bindings).filter((skill) => skillNameSet.has(skill));

    if (removedSkills.length === 0) {
      unchangedTargetCount += 1;
      skippedTargets.push({ ...target, reason: 'SKILLS_NOT_APPLIED' });
      continue;
    }

    try {
      const nextBindings: SkillBindings = { ...bindings };
      for (const name of removedSkills) delete nextBindings[name];
      await agent.patchFront({ skills: nextBindings });
      updatedTargets.push({ ...target, removedSkills });
      removedBindingCount += removedSkills.length;
    } catch {
      failedCount += 1;
      skippedTargets.push({ ...target, reason: 'UPDATE_FAILED' });
    }
  }

  logger.info({ msg: '[removeSkillsFromAgents] Completed skill removal from agents', mod: 'removeSkillsFromAgents', skillNames, updatedAgentCount: updatedTargets.length, removedBindingCount, unchangedTargetCount, failedCount, skippedCount: skippedTargets.length });

  const success = updatedTargets.length > 0 && failedCount === 0;
  const message = updatedTargets.length > 0
    ? `Removed ${removedBindingCount} skill binding${removedBindingCount === 1 ? '' : 's'} from ${updatedTargets.length} agent${updatedTargets.length === 1 ? '' : 's'}.`
    : skippedTargets.length > 0 && failedCount === 0
      ? 'The requested skills were not applied to any resolved target agents.'
      : 'Failed to remove the requested skills from the target agents.';

  return {
    success,
    skillNames,
    message,
    updatedAgentCount: updatedTargets.length,
    removedBindingCount,
    unchangedTargetCount,
    failedCount,
    updatedTargets,
    skippedTargets,
    error: success ? undefined : (updatedTargets.length === 0 ? 'NO_AGENT_UPDATES' : 'PARTIAL_FAILURE'),
  };
}
