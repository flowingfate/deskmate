import { log } from '@main/log';
import { Profiles } from '../../persist';
import type { Agent } from '../../persist/agent';
import { setSkillTier } from '@shared/types/profileTypes';

const logger = log;

export interface SkillAgentTarget {
  agentId: string;
  agentName: string;
}

export interface ApplySkillToAgentsOptions {
  skillName: string;
  targets?: SkillAgentTarget[];
  agentIds?: string[];
  agentNames?: string[];
  applyToAll?: boolean;
  requestSource?: string;
}

export interface ApplySkillToAgentsResult {
  success: boolean;
  skillName: string;
  message: string;
  appliedCount: number;
  alreadyAppliedCount: number;
  failedCount: number;
  appliedTargets: SkillAgentTarget[];
  skippedTargets: Array<SkillAgentTarget & { reason: string }>;
  error?: string;
}

function normalizeStringArray(values?: string[]): string[] {
  return Array.from(new Set((values || []).map(value => value?.trim()).filter((value): value is string => !!value)));
}

function targetKey(target: SkillAgentTarget): string {
  return `${target.agentId}::${target.agentName}`;
}

function resolveTargets(agents: Agent[], options: ApplySkillToAgentsOptions): SkillAgentTarget[] {
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
  const shouldApplyToAll = options.applyToAll === true;

  if (!shouldApplyToAll && agentIds.size === 0 && agentNames.size === 0) {
    return [];
  }

  const resolved: SkillAgentTarget[] = [];
  for (const agent of agents) {
    if (!shouldApplyToAll && agentIds.size > 0 && !agentIds.has(agent.id)) {
      continue;
    }
    if (!shouldApplyToAll && agentNames.size > 0 && !agentNames.has(agent.config.name)) {
      continue;
    }
    resolved.push({ agentId: agent.id, agentName: agent.config.name });
  }

  return Array.from(new Map(resolved.map(target => [targetKey(target), target])).values());
}

export async function applySkillToAgents(
  options: ApplySkillToAgentsOptions,
): Promise<ApplySkillToAgentsResult> {
  const skillName = options.skillName?.trim();
  if (!skillName) {
    return {
      success: false,
      skillName: options.skillName || '',
      message: 'skillName is required',
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
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
      skillName,
      message: 'User profile not found or does not support skills',
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [],
      error: 'PROFILE_NOT_FOUND',
    };
  }

  const installedSkill = profile.skills.get(skillName);
  if (!installedSkill) {
    return {
      success: false,
      skillName,
      message: `Skill "${skillName}" is not added to the profile's global skill list.`,
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [],
      error: 'SKILL_NOT_INSTALLED',
    };
  }

  const records = profile.listAgents();
  const allAgents: Agent[] = [];
  for (const rec of records) {
    const a = await profile.getAgent(rec.id);
    if (a) allAgents.push(a);
  }

  const resolvedTargets = resolveTargets(allAgents, options);
  if (resolvedTargets.length === 0) {
    return {
      success: false,
      skillName,
      message: 'No target agents resolved for skill application.',
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [],
      error: 'NO_TARGETS',
    };
  }

  const agentById = new Map(allAgents.map(a => [a.id, a]));
  const skippedTargets: Array<SkillAgentTarget & { reason: string }> = [];
  const appliedTargets: SkillAgentTarget[] = [];
  let alreadyAppliedCount = 0;
  let failedCount = 0;

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
    // 已有任一档位（live/lazy）即视为已绑定，避免把 lazy 覆盖成 live。
    if (bindings[skillName] !== undefined) {
      alreadyAppliedCount += 1;
      skippedTargets.push({ ...target, reason: 'ALREADY_APPLIED' });
      continue;
    }

    try {
      // bind 语义 = 第一档 自动启用。
      await agent.patchFront({ skills: setSkillTier(bindings, skillName, 'live') });
      appliedTargets.push(target);
    } catch {
      failedCount += 1;
      skippedTargets.push({ ...target, reason: 'UPDATE_FAILED' });
    }
  }

  logger.info({ msg: '[applySkillToAgents] Completed skill application', mod: 'applySkillToAgents', skillName, appliedCount: appliedTargets.length, alreadyAppliedCount, failedCount, skippedCount: skippedTargets.length });

  const success = appliedTargets.length > 0 && failedCount === 0;
  const message = appliedTargets.length > 0
    ? `Applied skill "${skillName}" to ${appliedTargets.length} agent${appliedTargets.length === 1 ? '' : 's'}.`
    : skippedTargets.length > 0 && failedCount === 0
      ? `Skill "${skillName}" was already applied to all resolved target agents.`
      : `Failed to apply skill "${skillName}" to the requested agents.`;

  return {
    success,
    skillName,
    message,
    appliedCount: appliedTargets.length,
    alreadyAppliedCount,
    failedCount,
    appliedTargets,
    skippedTargets,
    error: success ? undefined : (appliedTargets.length === 0 ? 'NO_AGENT_UPDATES' : 'PARTIAL_FAILURE'),
  };
}
