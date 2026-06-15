/**
 * pi 路径下的 agent / model 配置 reader。
 *
 * 读路径走 `Profiles.get().active() → profile.getAgent(id)`。
 *
 * pi 的 `model` 字段必须是 `${provider}::${modelId}` 复合 key；
 * 与 core 的裸 modelId 语义不兼容，缺失 / 错格式都让 UI 走重选流程，
 * 不要 fallback 到默认模型（默认模型可能没登录对应 provider，会掩盖问题）。
 */

import { Profiles } from '@main/persist';
import { parseAgentModel, type ParsedAgentModel } from '@shared/utils/agentModelId';
import type { ThinkingLevel } from '@shared/types/thinkingLevel';

/**
 * pi 内部使用的 agent runtime 视图。字段名以新 persist (camelCase) 为准。
 */
export interface AgentConfig {
  emoji: string;
  name: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
  /**
   * 本地工具白名单(deskmate 原生)。缺席 / 空数组 ⇒ 全开;非空 ⇒ 仅列表内。
   * 与外部 MCP 的 `mcpServers` 独立 —— 两个维度故意不对称(本地工具默认有,
   * 外部 MCP 显式集成才有),见 task.md §3.5。
   */
  tools?: string[];
  mcpServers: Array<{ name: string; tools: string[] }>;
  systemPrompt: string;
  subAgents?: string[];
  skills?: string[];
}

export async function readAgentConfig(profileId: string, agentId: string): Promise<AgentConfig | null> {
  const profiles = Profiles.get();
  // profileId 必须与当前 active 一致 —— pi 调用面只对 active profile 工作；
  // 跨 profile 访问属于 IPC 边界事故，宁可早抛也别静默读错文件。
  if (profiles.activeProfileId !== profileId) {
    throw new Error(
      `[pi/config] profileId mismatch: requested "${profileId}" but active is "${profiles.activeProfileId}"`,
    );
  }
  const profile = await profiles.active();
  const agent = await profile.getAgent(agentId);
  if (!agent) return null;

  const c = agent.config;
  return {
    emoji: c.emoji ?? '',
    name: c.name,
    model: c.model,
    thinkingLevel: c.thinkingLevel,
    tools: c.tools,
    // mcpServers 在新 schema 里 tools 是 optional;pi 下游期望 string[],缺席补空
    mcpServers: (c.mcpServers ?? []).map((s) => ({ name: s.name, tools: s.tools ?? [] })),
    systemPrompt: agent.systemPrompt,
    subAgents: c.subAgents,
    skills: c.skills,
  };
}
/**
 * 一次性读取 turn loop 所需的 agent 配置 + parsed model 元组。
 *
 * 不在这里解析 capability —— capability 由 `pi/model.getModelInfo(parsed)`
 * 在需要的地方按需取。让 capability 派生只有一处（model.ts），避免历史
 * 上"GHC 走 ghcModelsManager / 其它走 pi-ai"的双分支重新长回来。
 */
export type AgentRuntimeConfigResult =
  | { ok: true; agent: AgentConfig; parsedModel: ParsedAgentModel }
  | { ok: false; error: string };

export async function readAgentRuntimeConfig(profileId: string, agentId: string): Promise<AgentRuntimeConfigResult> {
  const agent = await readAgentConfig(profileId, agentId);
  if (!agent) return { ok: false, error: 'Agent configuration not found' };
  const parsedModel = parseAgentModel(agent.model);
  if (!parsedModel) {
    return { ok: false, error: 'Agent model misconfigured; please reselect a model' };
  }
  return { ok: true, agent, parsedModel };
}
