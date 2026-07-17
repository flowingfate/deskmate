/**
 * pi 路径下的 system prompt 拼装（自包含，不依赖 lib/chat 或 lib/skill）。
 *
 * 拼接顺序：custom（agent.systemPrompt） → agent-specific（identity + knowledge +
 * boundSkills） → global。各段缺数据时整段跳过。
 *
 * 模板字符串集中在 `./utils/promptTemplates`；本文件只负责"取数据 + 决定段是否出现"。
 * skill snapshot 不落盘（overview §3.3）；workspace / deliverables 概念已删（§3.5）。
 */

import { Profiles } from '@main/persist';
import type { Profile } from '@main/persist/profile';
import { log } from '@main/log';

import type { AgentConfig } from './utils/config';
import { liveSkillNames, lazySkillNames } from '@shared/types/profileTypes';
import { getGlobalSystemPrompt } from './utils/globalSystemPrompt';
import {
  identityBlock,
  knowledgeBlock,
  boundSkillsBlock,
} from './utils/promptTemplates';

const logger = log;

export async function buildSystemPrompt(args: {
  agentCfg: AgentConfig;
  profileId: string;
  agentId: string;
  sessionId: string;
}): Promise<string> {
  const { agentCfg, profileId } = args;

  const profile = await Profiles.get().active();
  if (profile.id !== profileId) {
    throw new Error(`[pi/prompt] profileId mismatch: requested "${profileId}" but active is "${profile.id}"`);
  }

  const segments: string[] = [];
  if (agentCfg.systemPrompt && agentCfg.systemPrompt.trim().length > 0) {
    segments.push(agentCfg.systemPrompt);
  }
  const specific = await buildAgentSpecific(agentCfg, profile);
  if (specific) segments.push(specific);
  segments.push(getGlobalSystemPrompt());

  return segments.join('\n\n---\n\n');
}

async function buildAgentSpecific(
  agentCfg: AgentConfig,
  profile: Profile,
): Promise<string> {
  const blocks: string[] = [];
  blocks.push(identityBlock(agentCfg.name));
  blocks.push(knowledgeBlock());
  const bound = buildBoundSkills(agentCfg, profile);
  if (bound) blocks.push(bound);

  return blocks.join('');
}

/**
 * 只把 live skill 的元数据放进 system prompt。它完全由 agent 配置决定，跨 turn 稳定，
 * 因而不破坏 provider 的前缀 KV cache。lazy skill 不列在这里：用户的 `@skill://<name>`
 * 引用本身落在 user message，模型按稳定指引自行 `read skill://<name>`。
 */
function buildBoundSkills(agentCfg: AgentConfig, profile: Profile): string {
  const bindings = agentCfg.skills;
  const liveNames = normalizeNames(liveSkillNames(bindings));
  const hasLazySkills = lazySkillNames(bindings).length > 0;
  if (liveNames.length === 0 && !hasLazySkills) return '';

  const wanted = liveNames;

  const items: Array<{ name: string; description: string; version: string; filePath: string }> = [];
  const missing: string[] = [];
  for (const name of wanted) {
    const skill = profile.skills.get(name);
    if (!skill) { missing.push(name); continue; }
    items.push({
      name: skill.name,
      description: skill.description || 'No description available',
      version: skill.version || 'N/A',
      filePath: `skill://${skill.name}`,
    });
  }
  if (missing.length > 0) {
    logger.info({
      msg: '[pi/prompt] Missing skills referenced by agent',
      profileId: profile.id, agent: agentCfg.name, missing,
      requested: wanted.length, resolved: items.length,
    });
  }
  return boundSkillsBlock(items, { hasLazySkills });
}


function normalizeNames(names?: string[]): string[] {
  if (!Array.isArray(names)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const n = raw.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
