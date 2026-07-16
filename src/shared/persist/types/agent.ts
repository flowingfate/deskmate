import type { AgentMcpServer, SkillBindings } from './resource';
import type { ThinkingLevel } from './thinking';

/** `agents/agents.json`。 */
export interface AgentRegistryFile {
  version: 1;
  /** primary agent id（用户偏好；删除当前 agent 时回退到此处）。 */
  primaryAgentId?: string;
  /** items 的顺序即侧边栏渲染顺序，即唯一 source of truth。 */
  items: AgentRecord[];
}

export interface AgentRecord {
  id: string;
  name: string;
  /** AGENT.md front-matter `description` 的 hot 缓存，供列表与委派选择使用。 */
  description?: string;
  version: string;
  emoji?: string;
  avatar?: string;
  /** AGENT.md front-matter `locked` 的 hot 缓存。 */
  locked?: boolean;
  /** AGENT.md front-matter `model` 的 hot 缓存。 */
  model: string;
  createdAt: string;
  updatedAt: string;
}

/** 聊天空态可点击的预设提示词，落 `AGENT.md#zero.preset_prompts`。 */
export interface PresetPrompt {
  id: string;
  title: string;
  description?: string;
  prompt: string;
  /** 语义图标 key；renderer 负责解析为 Lucide 组件。 */
  iconKey: string;
}

export interface AgentZeroState {
  preset_prompts: PresetPrompt[];
}

/** `AGENT.md` front-matter。 */
export interface AgentMarkdownFront {
  name: string;
  description?: string;
  emoji?: string;
  avatar?: string;
  locked?: boolean;
  version: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
  /** 本地工具白名单；缺席 / 空表示全部可用。 */
  tools?: string[];
  mcpServers?: AgentMcpServer[];
  skills?: SkillBindings;
  subAgents?: string[];
  /** 可委派的普通 Agent ID；允许保留暂不可用的 dangling ID。 */
  delegates?: string[];
  zero?: AgentZeroState;
}

export interface AgentMarkdownFile {
  frontMatter: AgentMarkdownFront;
  systemPrompt: string;
}

/** `Agent.patchFront` 与 IPC 共用的 front-matter patch。 */
export type AgentFrontPatch =
  & Partial<Pick<AgentRecord, 'name' | 'description' | 'version' | 'model' | 'emoji' | 'avatar' | 'locked'>>
  & Partial<Pick<AgentDetail, 'tools' | 'mcpServers' | 'skills' | 'subAgents' | 'delegates' | 'zero'>>
  & { thinkingLevel?: ThinkingLevel | null };

/** `agent:create` IPC 入参。 */
export interface CreateAgentInput {
  name: string;
  description?: string;
  version?: string;
  model?: string;
  emoji?: string;
  avatar?: string;
  systemPrompt?: string;
  front?: AgentFrontPatch;
}

export interface ArchivedAgentEntry {
  archivedId: string;
  archivedAt: string;
  record: AgentRecord;
  markdown: AgentMarkdownFile | null;
}

/** AGENT.md cold 字段集合。 */
export interface AgentDetail {
  agentId: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt: string;
  tools?: string[];
  mcpServers?: AgentMcpServer[];
  skills?: SkillBindings;
  subAgents?: string[];
  /** 按配置顺序保存的普通 Agent ID；dangling ID 不会在此层丢失。 */
  delegates?: string[];
  zero?: AgentZeroState;
}
