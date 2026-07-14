import type { AgentMcpServer } from './resource';

export type SubAgentContextAccess = 'isolated' | 'parent_summary' | 'full_history';

/** Sub-agent MCP server configuration，兼容 Claude Code。 */
export type SubAgentMcpServerConfig = string | AgentMcpServer;

/** `sub-agents/{id}/AGENT.md` 完整配置。 */
export interface SubAgentConfig {
  /** Unique identifier (lowercase letters + digits + hyphens), required */
  name: string;
  /** Sub-agent display name */
  display_name: string;
  /** Description used by Claude for delegation decisions, required */
  description: string;
  /** Sub-agent emoji icon */
  emoji: string;
  /** Version number */
  version: string;
  /** Model selection: specific model name or 'inherit' (default: inherit) */
  model?: string;
  /** Maximum agent turns (camelCase, aligned with Claude Code maxTurns) */
  maxTurns?: number;
  /** Pre-loaded Skills name list */
  skills?: string[];
  /** MCP server configuration (camelCase, compatible with Claude Code mcpServers) */
  mcpServers?: SubAgentMcpServerConfig[];

  /** 本地工具白名单；缺席 / 空 ⇒ 全开。 */
  tools?: string[];
  /** 本地工具黑名单；从全集减去本列表。 */
  disallowTools?: string[];
  /** Sub-agent workspace path (optional, independent from parent) */
  workspace?: string;
  /** Sub-agent knowledge base path (optional) */
  knowledgeBase?: string;
  /** Context access mode */
  context_access: SubAgentContextAccess;
  /** Whether to inherit parent Agent's MCP server configuration (default: true) */
  inherit_mcp_servers?: boolean;
  /** Whether to inherit parent Agent's Skills configuration (default: true) */
  inherit_skills?: boolean;
  /** Whether to inherit parent Agent's Knowledge Base configuration (default: true) */
  inherit_knowledge_base?: boolean;

  /** Sub-agent system prompt，解析自 Markdown body，不进入 YAML front-matter。 */
  system_prompt: string;
}

/** 旧 `profile.json` 中的子代理轻量索引。 */
export interface SubAgentIndex {
  name: string;
  version: string;
}

/** `sub-agents/sub-agents.json`。 */
export interface SubAgentsIndexFile {
  version: 1;
  items: SubAgentRecord[];
}

/** `sub-agents/sub-agents.json` 单条轻量索引。 */
export interface SubAgentRecord {
  id: string;
  name: string;
  version: string;
}
