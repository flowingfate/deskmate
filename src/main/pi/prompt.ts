/**
 * pi 路径下的 system prompt 拼装（自包含，不依赖 lib/chat 或 lib/skill）。
 *
 * 拼接顺序：custom（agent.systemPrompt） → agent-specific（identity + knowledge +
 * fsSkills + boundSkills + subAgents） → global。各段缺数据时整段跳过。
 *
 * 模板字符串集中在 `./utils/promptTemplates`；本文件只负责"取数据 + 决定段是否出现"。
 * skill snapshot 不落盘（overview §3.3）；workspace / deliverables 概念已删（§3.5）。
 */

import { Profiles } from '@main/persist';
import type { Profile } from '@main/persist/profile';
import { log } from '@main/log';

import type { AgentConfig } from './utils/config';
import { getGlobalSystemPrompt } from './utils/globalSystemPrompt';
import {
  identityBlock,
  knowledgeBlock,
  boundSkillsBlock,
  subAgentsBlock,
  type SubAgentItem,
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
  const sub = await buildSubAgents(agentCfg, profile);
  if (sub) blocks.push(sub);

  return blocks.join('');
}

/**
 * agent.skills → profile.skills 注册表中找出对应项;missing 记 log;返回模板
 * 字符串或 ''。LLM 视角下 skill 用 `skill://<name>` URI 引用 —— `skill://`
 * handler 会解析到 `${profile}/skills/<name>/SKILL.md`,profile 绝对路径不
 * 暴露给 LLM。
 */
function buildBoundSkills(agentCfg: AgentConfig, profile: Profile): string {
  const wanted = normalizeNames(agentCfg.skills);
  if (wanted.length === 0) return '';

  const items: Array<{ name: string; description: string; version: string; filePath: string }> = [];
  const missing: string[] = [];
  for (const name of wanted) {
    const skill = profile.skills.items.find((s) => s.name === name);
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
  return boundSkillsBlock(items);
}

/** agent.subAgents → profile.subAgents.listConfigs() 过滤；返回模板字符串或 ''。 */
async function buildSubAgents(agentCfg: AgentConfig, profile: Profile): Promise<string> {
  const wanted = Array.isArray(agentCfg.subAgents) ? agentCfg.subAgents : [];
  if (wanted.length === 0) return '';

  const all = await profile.subAgents.listConfigs();
  const enabled = all.filter((sa) => wanted.includes(sa.name));
  if (enabled.length === 0) return '';

  const items: SubAgentItem[] = enabled.map((sa) => {
    const caps: string[] = [];
    if (sa.mcpServers && sa.mcpServers.length > 0) {
      const names = sa.mcpServers.map((s) => (typeof s === 'string' ? s : s.name));
      caps.push(`MCP Servers: ${names.join(', ')}`);
    }
    if (sa.skills && sa.skills.length > 0) {
      caps.push(`Skills: ${sa.skills.join(', ')}`);
    }
    caps.push(`Context Access: ${sa.context_access}`);
    caps.push(`Max Turns: ${sa.maxTurns ?? 25}`);
    return {
      name: sa.name,
      displayName: sa.display_name,
      emoji: sa.emoji,
      description: sa.description,
      capabilities: caps,
    };
  });

  return subAgentsBlock(items);
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
