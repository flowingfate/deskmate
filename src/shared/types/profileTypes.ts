/**
 * Type definitions for Profile configuration V2.
 *
 * Lives in `shared/` so IPC contracts (`src/shared/ipc/*`) can reference these
 * types without importing from the main process.
 */

import type {
  AgentMcpServer,
  ConfirmationSettings,
  McpServerConfig,
  SkillBindings,
  SkillTier,
  SubAgentConfig,
  SubAgentIndex,
  ThinkingLevel,
} from '../persist/types';


/** `skills` 映射中档位为 `'live'` 的 skill 名字（第一档，稳定顺序）。 */
export function liveSkillNames(bindings: SkillBindings | undefined): string[] {
  if (!bindings) return [];
  return Object.keys(bindings).filter((name) => bindings[name] === 'live');
}

/** `skills` 映射中档位为 `'lazy'` 的 skill 名字（第二档，稳定顺序）。 */
export function lazySkillNames(bindings: SkillBindings | undefined): string[] {
  if (!bindings) return [];
  return Object.keys(bindings).filter((name) => bindings[name] === 'lazy');
}

/** `skills` 映射中的全部 skill 名字（第一档 ∪ 第二档，稳定顺序）。 */
export function boundSkillNames(bindings: SkillBindings | undefined): string[] {
  if (!bindings) return [];
  return Object.keys(bindings);
}

/**
 * 把一个 skill 设为指定档位（不可变；返回新 map）。`tier === undefined` ⇒ 移除该 key（第三档）。
 */
export function setSkillTier(
  bindings: SkillBindings | undefined,
  name: string,
  tier: SkillTier | undefined,
): SkillBindings {
  const next: SkillBindings = { ...(bindings ?? {}) };
  if (tier === undefined) delete next[name];
  else next[name] = tier;
  return next;
}

/**
 * Agent-level resolved Skill snapshot item
 */
export interface AgentSkillSnapshotItem {
  /** Skill name */
  name: string;
  /** Skill description */
  description: string;
  /** Skill version */
  version: string;
  /** Absolute SKILL.md path */
  file_path: string;
}

/**
 * Agent-level Skill snapshot used by AgentChat at turn boundaries
 */
export interface AgentSkillSnapshot {
  /** Signature of normalized agent.skills */
  binding_signature: string;
  /** Signature of resolved installed skill metadata */
  registry_signature: string;
  /** Snapshot generation timestamp */
  generated_at: string;
  /** Resolved valid skills */
  skills: AgentSkillSnapshotItem[];
  /** Missing skill names referenced by the agent but not found in profile.skills */
  missing_skill_names?: string[];
  /** Prebuilt prompt text consumed by AgentChat */
  prompt: string;
}


/**
 * Sub-agent task execution result
 * Returned by SubAgentManager.spawnSubAgent(), contains complete task execution information
 */
export interface SubAgentTaskResult {
  subAgentName: string;
  taskId: string;
  success: boolean;
  result?: string;
  error?: string;
  turnCount: number;
  durationMs: number;
}

/**
 * Sub-agent execution step
 * Records each step of operation during sub-agent runtime (tool calls or text output)
 * Used for real-time UI progress display and future persistence
 */
export interface SubAgentStep {
  /** Step type: tool execution started / tool execution completed / tool execution failed / text output / turn started / LLM streaming text (open union type for future extensibility) */
  type: 'tool_start' | 'tool_done' | 'tool_error' | 'text' | 'turn_start' | 'llm_streaming' | string;
  /** Tool call ID (used for in-place replacement matching from tool_start -> tool_done/tool_error) */
  toolCallId?: string;
  /** Tool name (only for tool_* types) */
  toolName?: string;
  /** Human-readable summary of tool arguments (<=200 characters) */
  toolArgsSummary?: string;
  /** Current turn (1-based, indicates the turn being executed) */
  turn: number;
  /** Step timestamp (ms) */
  timestamp: number;
  /** Tool execution duration (only present for tool_done / tool_error, ms) */
  durationMs?: number;
  /** Tool result length (only present for tool_done, character count) */
  toolResultLength?: number;
  /** Text snippet (only for text type, truncated to <=2 lines) */
  textSnippet?: string;
}

/**
 * Sub-agent runtime state
 * Used to track sub-agent execution progress, pushed to Renderer via IPC for display
 */
export interface SubAgentRuntimeState {
  taskId: string;
  subAgentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  currentTurn: number;
  /** Correlated with parent toolCall.id, used for precise Renderer matching (resolves parallel same-name sub-agent conflicts) */
  correlationId?: string;
  /** Sub-agent max turns (from config, used for UI progress bar display) */
  maxTurns: number;
  /** Execution steps list (bounded, keeps at most 30 entries, FIFO eviction) */
  steps: SubAgentStep[];
  /** Most recent LLM text output snippet (<=4 lines, <=500 characters, for UI thinking process display) */
  lastTextSnippet?: string;
  /** Current LLM streaming text being generated (updated in real-time, cleared after turn ends) */
  streamingText?: string;
}




/**
 * User information from GitHub Copilot
 */
export interface GhcUser {
  /** User ID */
  id: string;
  /** GitHub username */
  login: string;
  /** User email address */
  email: string;
  /** User display name */
  name: string;
  /** User avatar URL */
  avatarUrl: string;
  /** GitHub Copilot plan type */
  copilotPlan: string;
}

/**
 * Authentication tokens for GitHub Copilot
 */
export interface GhcTokens {
  /** Refresh token */
  refresh: string;
  /** Access token */
  access: string;
  /** Token expiration timestamp */
  expires: number;
}





/**
 * Agent persona shape (snake_case，落盘形态由 AGENT.md front-matter 反序列化得到)。
 * V2 重构后真值是 AgentRecord+AgentDetail，AgentPersona 仅为 renderer 兼容层
 * （`agentOps.ts`、AgentEditingView 的 patch 形状）使用。新代码请直接消费
 * `AgentRecord` / `AgentDetail`（@shared/persist/types）。
 */
export interface AgentPersona {
  /** Agent role */
  role: string;
  /** Agent emoji */
  emoji: string;
  /** Agent avatar URL (optional) */
  avatar?: string;
  /** Agent name */
  name: string;
  /**
   * Model used.
   *
   * Step 9+ 格式：`${provider}::${modelId}`，例如
   * - `github-copilot::claude-sonnet-4.6`
   * - `anthropic::claude-opus-4-5-20251101`
   * - `openai::gpt-5`
   *
   * 复合 model key：`${provider}::${modelId}`（如 `github-copilot::claude-sonnet-4.6`）。
   * 历史上曾允许裸 modelId（GHC 单 provider 时代），2026-05-30 起统一为复合 key。
   * —— 读到不含 `::` 的值 UI 提示"Model misconfigured, please select a
   * model"，由用户手动重选。
   */
  model: string;
  /** Agent version */
  version?: string;
  /** Agent-specific MCP server list (new structure: includes tool selection) */
  mcp_servers: AgentMcpServer[];
  /**
   * 本地工具白名单(deskmate 原生)。缺席 / 空 ⇒ 全开;非空 ⇒ 仅列表内。
   * 与 `mcp_servers` 独立 —— 默认 agent 写空数组表示"全开本地工具,无外部 MCP"。
   */
  tools?: string[];
  /** System prompt */
  system_prompt: string;
  /**
   * 单聊会话当前选中的 thinking level(与 pi-ai 一致的等级集)。
   *
   * 取值:
   * - `undefined`:不发送 reasoning 参数,由 provider 决定默认。
   * - `ThinkingLevel`:透传给 pi.streamSimple({reasoning})。
   * - `null`:UI 显式"清除"的写时 sentinel(区别于 undefined "不改")。
   *   只在 IPC patch 阶段出现;持久化层落盘前会被还原为缺席字段。
   *
   * 字段名沿用持久化 schema (`AGENT.md` front-matter `thinkingLevel`)。
   */
  thinkingLevel?: ThinkingLevel | null;
  /** Skill 启用档位映射（第一/二/三档）；语义同 `AgentMarkdownFrontBase.skills`。 */
  skills?: SkillBindings;
  /** Sub-agent name list referenced by the Agent */
  sub_agents?: string[];
}

/**
 * AgentEnvelope —— 历史 `ChatConfig` 形态的重命名 + 清场版本。Agent 在 V2 已是
 * 一等公民，渲染器仍有少量代码（`agentOps.ts`、AgentEditingView）依赖
 * 这个 envelope 形状（`agent_id` 即是 agent 的 ULID）。新代码不要使用本类型，
 * 直接消费 `AgentRecord` / `AgentDetail`（@shared/persist/types）。
 *
 * 历史上还有 `chat_type: 'single_agent' | 'multi_agent'` 与 `agents?: ChatAgent[]`
 * 两个字段：multi_agent 形态从未上线，已整体删除；原 `chat_id` 字段重命名为
 * `agent_id`。
 */
export interface AgentEnvelope {
  /** Agent 的 ULID（持久化层 `Agent.id`）。 */
  agent_id: string;
  /** Agent persona configuration */
  agent: AgentPersona;
  /** Agent-level resolved skill snapshot, refreshed lazily at next-turn boundary */
  skill_snapshot?: AgentSkillSnapshot;
}






/**
 * Profile configuration interface
 */
export interface Profile {
  /** Profile schema version (0, 1, 2, …) */
  version: number;
  /** Created time */
  createdAt: string;
  /** Updated time */
  updatedAt: string;
  /** User alias */
  alias: string;
  /** Whether First Run Experience is completed */
  freDone?: boolean;
  /** Primary Agent, displayed first in AgentChatList and used as the default Agent on app startup. Falls back to the first agent when unset. */
  primaryAgent?: string;
  /** MCP server configuration */
  mcp_servers: McpServerConfig[];
  /**
   * Sub-Agent lightweight index (after file-based refactoring)
   * Full configuration is stored in agents/{name}/AGENT.md files,
   * only name/version are kept here for ProfileCacheManager notification.
   */
  sub_agents?: SubAgentIndex[];
  /** Confirmation dialog preferences */
  confirmationSettings?: ConfirmationSettings;
}


// ═══════════════════════════════════════════
// Runtime constants and helpers
// ═══════════════════════════════════════════

/** Default model ID — consistent with GhcModelsManager.getDefaultModel() */
const DEFAULT_MODEL_ID = 'claude-sonnet-4.6';

/**
 * Default sub-agent configuration
 */
export const DEFAULT_SUB_AGENT_CONFIG: Partial<SubAgentConfig> = {
  context_access: 'isolated',
  maxTurns: 25,
  model: 'inherit',
  mcpServers: [],
  skills: [],
  tools: [],
  disallowTools: [],
  knowledgeBase: '',
  inherit_mcp_servers: true,
  inherit_skills: true,
  inherit_knowledge_base: true,
};

/**
 * Sub-agent resource limit constants
 */
export const SUB_AGENT_LIMITS = {
  MAX_PARALLEL_TASKS: 5,
  MAX_SPAWNS_PER_SESSION: 20,
  DEFAULT_MAX_TURNS: 25,
} as const;

/**
 * Default Agent persona configuration
 */
export const DEFAULT_AGENT_PERSONA: AgentPersona = {
  role: "Default Assistant",
  emoji: "🦦",
  avatar: "",
  name: "Otto",
  model: DEFAULT_MODEL_ID,
  version: "1.0.0",
  // 不引外部 MCP;`tools: []` ⇒ 本地工具全开(见 `AgentMarkdownFrontBase.tools` 语义)。
  mcp_servers: [],
  tools: [],
  system_prompt: "You are a highly capable AI assistant designed to help users with a wide variety of tasks. Your core capabilities include:\n\n**Communication & Analysis:**\n- Provide clear, accurate, and helpful responses to questions\n- Analyze complex problems and break them down into manageable parts\n- Adapt your communication style to match the user's needs and expertise level\n\n**Technical Assistance:**\n- Help with programming, debugging, and code review across multiple languages\n- Assist with data analysis, research, and information synthesis\n- Provide guidance on best practices and technical decision-making\n\n**Creative & Productive Support:**\n- Generate creative content including writing, brainstorming, and ideation\n- Help with planning, organization, and project management\n- Assist with document creation, editing, and formatting\n\n**Interaction Guidelines:**\n- Always strive for accuracy and cite sources when appropriate\n- Ask clarifying questions when requirements are unclear\n- Provide step-by-step explanations for complex procedures\n- Respect user privacy and maintain confidentiality\n- Be honest about limitations and uncertainties\n\n**Tools & Integration:**\n- Leverage available MCP servers and tools to enhance capabilities\n- Use web browsing, file operations, and data processing tools when beneficial\n- Integrate multiple information sources to provide comprehensive responses\n\nYour goal is to be a reliable, knowledgeable, and adaptable assistant that helps users accomplish their objectives efficiently and effectively.",
  skills: {},
};

/**
 * Type guard for McpServerConfig
 */
export function isMcpServerConfig(obj: any): obj is McpServerConfig {
  return (
    obj &&
    typeof obj.name === 'string' &&
    typeof obj.transport === 'string' &&
    ['stdio', 'sse', 'StreamableHttp'].includes(obj.transport) &&
    typeof obj.command === 'string' &&
    Array.isArray(obj.args) &&
    typeof obj.env === 'object' &&
    typeof obj.url === 'string' &&
    typeof obj.in_use === 'boolean'
  );
}



/**
 * Default MCP server configuration
 */
export const DEFAULT_MCP_SERVER: McpServerConfig = {
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  env: {},
  url: "",
  in_use: true,
  version: "1.0.0",
};



export const DEFAULT_CONFIRMATION_SETTINGS: ConfirmationSettings = {
  inlineEditRegenerate: {
    skipConfirmation: false,
  },
};


