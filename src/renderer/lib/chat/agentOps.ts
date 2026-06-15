/**
 * Agent Configuration Operations
 *
 * 兼容层：保留老 `AgentEnvelope` / `AgentPersona` 形态（profileTypes 中的 compat 类型）的
 * 函数签名,让上层组件零改动迁移；内部全部走 `persistApi.*` 新 IPC 通道。
 * snake_case ↔ camelCase 的映射在本文件内部完成,不允许蔓延到 IPC 边界。
 *
 * 历史债：agent 概念曾被错叫做 chat；新模型下 agent 是一等公民,本文件暴露的
 * `agentId` 即是 agent 的 ULID（不再是 `chat_<…>`）。
 */

import { AgentEnvelope, AgentPersona, DEFAULT_AGENT_PERSONA } from '@shared/types/profileTypes';
import { persistApi } from '@/ipc/persist';
import { getAgentById, getAgents } from '@/states/agents.atom';
import { getProfileId } from '@/states/profile.atom';
import type { AgentDetail, AgentFrontPatch, AgentRecord } from '@shared/persist/types';

export interface AgentOperationResult {
  success: boolean;
  error?: string;
  data?: any;
}



/** snake_case Partial<AgentPersona> → AgentFrontPatch + systemPrompt（独立字段）。 */
function agentPersonaToPatch(partial: Partial<AgentPersona>): { patch: AgentFrontPatch; systemPrompt?: string } {
  const patch: AgentFrontPatch = {};
  if (partial.name !== undefined)            patch.name = partial.name;
  if (partial.version !== undefined)         patch.version = partial.version;
  if (partial.model !== undefined)           patch.model = partial.model;
  if (partial.emoji !== undefined)           patch.emoji = partial.emoji;
  if (partial.avatar !== undefined)          patch.avatar = partial.avatar;
  // thinkingLevel 三态透传：undefined=不变 / ThinkingLevel=写入 / null=清除
  if (partial.thinkingLevel !== undefined) patch.thinkingLevel = partial.thinkingLevel;
  if (partial.tools !== undefined)           patch.tools = partial.tools;
  if (partial.mcp_servers !== undefined)     patch.mcpServers = partial.mcp_servers;
  if (partial.skills !== undefined)          patch.skills = partial.skills;
  if (partial.sub_agents !== undefined)      patch.subAgents = partial.sub_agents;
  if (partial.zero_states !== undefined) {
    patch.zeroStates = {
      greeting: partial.zero_states.greeting,
      quickStarts: partial.zero_states.quick_starts,
    };
  }
  return {
    patch,
    systemPrompt: partial.system_prompt,
  };
}

/**
 * `(AgentRecord, AgentDetail|null) → AgentEnvelope`。detail===null 时只能填
 * record 字段；cold 字段（systemPrompt / mcpServers / skills / subAgents /
 * knowledge / zeroStates / thinkingLevel）退化为空/缺席。caller 若需要完整
 * envelope，请先 `await persistApi.getAgentDetail(record.id)` 再传 detail。
 */
function agentRecordToConfig(record: AgentRecord, detail: AgentDetail | null): AgentEnvelope {
  const agent: AgentPersona = {
    role: '',
    emoji: record.emoji ?? '',
    name: record.name,
    model: record.model,
    mcp_servers: detail?.mcpServers ?? [],
    system_prompt: detail?.systemPrompt ?? '',
  };
  if (record.avatar !== undefined)                                          agent.avatar = record.avatar;
  if (record.version !== undefined)                                         agent.version = record.version;
  if (detail?.thinkingLevel !== undefined)                                  agent.thinkingLevel = detail.thinkingLevel;
  if (detail?.tools !== undefined)                                          agent.tools = detail.tools;
  if (detail?.skills !== undefined)                                         agent.skills = detail.skills;
  if (detail?.subAgents !== undefined)                                      agent.sub_agents = detail.subAgents;
  if (detail?.zeroStates !== undefined) {
    agent.zero_states = {
      greeting: detail.zeroStates.greeting,
      quick_starts: detail.zeroStates.quickStarts,
    };
  }
  return { agent_id: record.id, agent };
}

function validateUser(): string {
  const id = getProfileId();
  if (!id) throw new Error('No user authenticated. Please sign in first.');
  return id;
}

export async function addAgentConfig(envelope: Partial<AgentEnvelope>): Promise<AgentOperationResult> {
  try {
    validateUser();
    const a = envelope.agent ?? { ...DEFAULT_AGENT_PERSONA } as AgentPersona;
    const { patch, systemPrompt } = agentPersonaToPatch(a);
    const { name: _n, version: _v, model: _m, emoji: _e, avatar: _av, ...front } = patch;
    const result = await persistApi.createAgent({
      name: a.name,
      version: a.version ?? '1.0.0',
      model: a.model,
      emoji: a.emoji,
      avatar: a.avatar,
      systemPrompt,
      front,
    });
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: { ...envelope, agent_id: result.data!.id } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteAgentConfig(agentId: string): Promise<AgentOperationResult> {
  try {
    validateUser();
    if (!agentId?.trim()) return { success: false, error: 'agentId is required' };
    const result = await persistApi.archiveAgent(agentId);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: { agentId } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}


export async function updateAgent(agentId: string, agentUpdates: Partial<AgentPersona>): Promise<AgentOperationResult> {
  try {
    validateUser();
    if (!agentId?.trim()) return { success: false, error: 'agentId is required' };
    const { patch, systemPrompt } = agentPersonaToPatch(agentUpdates);
    const result = await persistApi.patchAgentFront(agentId, patch, systemPrompt);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: { agentId, agentUpdates } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}


export async function duplicateAgent(agentId: string, newName?: string): Promise<AgentOperationResult> {
  try {
    validateUser();
    const agentName = newName?.trim() || 'Agent Copy';
    const result = await persistApi.duplicateAgent(agentId, agentName);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, data: { agent_id: result.data!.id } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
