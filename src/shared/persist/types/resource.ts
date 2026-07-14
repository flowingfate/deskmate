/** 支持导入的外部 Agent skills 来源 registry id。 */
export type ForeignSkillSourceId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'agents'
  | 'universal-agents'
  | 'opencode'
  | 'gemini-cli'
  | 'copilot';

/** 外部 Agent 导入 skill 的来源溯源。 */
export type ForeignSkillSourceKind = 'link' | 'copy';

export interface ForeignSkillSource {
  kind: ForeignSkillSourceKind;
  /** 来源 Agent 的 registry id，如 `claude-code`。 */
  id: ForeignSkillSourceId;
  /** 来源 Agent 的展示名，如 `Claude Code`。 */
  label: string;
  /** 外部源目录绝对路径（仅本地 UI / 管理用，不进入 LLM prompt）。 */
  originalPath: string;
  importedAt: number;
}

/** `skills/skills.json` 的单条配置。 */
export interface SkillConfig {
  /** Skill name (also used as folder name) */
  name: string;
  /** Skill description */
  description: string;
  /** Skill version */
  version: string;
  /** 外部 Agent 导入的来源溯源；仅 foreign-agent 导入的 skill 有此字段。 */
  foreign?: ForeignSkillSource;
}

export type SkillTier = 'live' | 'lazy';

/** 落在 `AGENT.md` front-matter `skills` 的启用档位映射。 */
export type SkillBindings = Record<string, SkillTier>;

/** `mcp/mcp.json` 的单条 server 配置。 */
export interface McpServerConfig {
  /** Name of the MCP server */
  name: string;
  /** Transport type ('stdio', 'sse', or 'StreamableHttp') */
  transport: 'stdio' | 'sse' | 'StreamableHttp' | string;
  /** Command to execute (for stdio transport) */
  command: string;
  /** Command line arguments */
  args: string[];
  /** Environment variables */
  env: Record<string, string>;
  /** Server URL (for sse/http transport) */
  url: string;
  /** Whether this server is currently in use */
  in_use: boolean;
  /** MCP server version */
  version?: string;
  /** HTTP headers for sse/http transports (e.g. Authorization) */
  headers?: Record<string, string>;
  /** Optional OAuth 2.0 configuration for HTTP/SSE servers. */
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    callbackPort?: number;
    authServerMetadataUrl?: string;
    setupUrl?: string;
    setupInstructions?: string[];
  };
}

/** `AGENT.md` 里 MCP server 的选择结果。 */
export interface AgentMcpServer {
  /** MCP server name */
  name: string;
  /** Selected tool list for the current agent */
  tools: string[];
}

/** `models/{provider}.json` 中的单个 model 配置。 */
export interface ModelModalities {
  input: string[];
  output: string[];
}

export interface ModelLimit {
  context: number;
  output: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  knowledge: string;
  release_date: string;
  last_updated: string;
  modalities: ModelModalities;
  open_weights: boolean;
  limit: ModelLimit;
}

/** `models/{provider}.json`。 */
export interface ModelsCacheFile {
  version: 1;
  models: ModelConfig[];
  updatedAt: string;
  count: number;
}

/** `mcp/mcp.json`。 */
export interface McpServersFile {
  version: 1;
  items: McpServerRecord[];
}

export type McpServerRecord = McpServerConfig;

/** `skills/skills.json`。 */
export interface SkillsIndexFile {
  version: 1;
  items: SkillRecord[];
}

export type SkillRecord = SkillConfig;
