/**
 * Sub-Agent Runtime Type Definitions
 *
 * 持久化 schema 位于 `src/shared/persist/types/index.ts`；本文件只定义子代理运行时状态。
 */

import type { SubAgentConfig } from '@shared/persist/types';
import type { SubAgentRuntimeState } from '@shared/types/profileTypes';

/**
 * Sub-Agent Runtime Entity
 *
 * Relationship with SubAgentConfig (persistence config):
 * - SubAgentConfig = static config stored in profile.json (similar to SkillConfig)
 * - SubAgent       = fully resolved runtime entity, including runtime info inherited from the parent
 *
 * Usage: In SubAgentManager.spawnSubAgent(), SubAgentConfig + parent runtime info
 *        are merged into a SubAgent instance and passed to SubAgentChat
 */
export interface SubAgent {
  /** Sub-agent config (from Profile.sub_agents) */
  config: SubAgentConfig;
  /** Effective LLM model ID resolved at runtime: sub-agent override or parent Agent fallback */
  inheritedModel: string;
  /** Parent Agent's agentId (used to track parent-child relationships) */
  parentAgentId: string;
  /** Parent Agent's chatSessionId */
  parentSessionId: string;
  /** Parent Agent's profile id */
  profileId: string;
  /** Resolved available MCP server connection status */
  resolvedMcpServers: Array<{
    name: string;
    connected: boolean;
    tools: string[];
    /** Whether inherited from the parent */
    inherited: boolean;
  }>;
  /** Resolved available Skills (actual content looked up from profile) */
  resolvedSkills: Array<{
    name: string;
    installed: boolean;
    /** Whether inherited from the parent */
    inherited: boolean;
  }>;
  /** Resolved Knowledge Base path (final value after inheritance merge) */
  resolvedKnowledgeBase?: string;
  /** Task ID assigned at runtime */
  taskId: string;
}

/**
 * Sub-agent step update event
 * Fired by SubAgentChat before/after tool execution and after text output,
 * passed to SubAgentManager via the onStepUpdate callback for assembly and IPC push.
 *
 * Semantic convention: the turn field indicates "the currently in-progress turn" (1-based),
 * which has a +1 offset from onTurnComplete's turn (the number of completed turns).
 * This is by design — step events occur during turn execution, while onTurnComplete fires after a turn ends.
 */
export interface SubAgentStepUpdate {
  /** Step type */
  type: 'tool_start' | 'tool_done' | 'tool_error' | 'text' | 'turn_start' | 'llm_streaming';
  /** Tool call ID (used for in-place replacement matching from tool_start → tool_done/tool_error) */
  toolCallId?: string;
  /** Tool name (only for tool_* types) */
  toolName?: string;
  /** Human-readable summary of tool arguments */
  toolArgsSummary?: string;
  /** Current turn (1-based) */
  turn: number;
  /** Tool execution duration (only for tool_done / tool_error, in ms) */
  durationMs?: number;
  /** Tool result length (only for tool_done, in characters) */
  toolResultLength?: number;
  /** Most recent LLM text output snippet (only for text type) */
  lastTextSnippet?: string;
  /** Current LLM streaming text being generated (only for llm_streaming type) */
  streamingText?: string;
}

/**
 * Sub-agent chat engine options
 * Passed to the SubAgentChat constructor, containing all information needed at runtime
 */
export interface SubAgentChatOptions {
  /** Runtime sub-agent entity (includes config + parent-inherited info) */
  subAgent: SubAgent;
  /** Task description */
  task: string;
  /** Parent context summary (based on context_access mode) */
  parentContext?: string;
  /** Cancellation token */
  cancellationSignal: AbortSignal;
  /** Turn completion callback (turn = number of completed turns) */
  onTurnComplete?: (turn: number, lastMessage: string) => void;
  /** Step-level progress callback (fired before/after tool execution and after text output) */
  onStepUpdate?: (update: SubAgentStepUpdate) => void;
  /** Deliverables path (derived from parent session by SubAgentManager, used for file write guidance) */
  deliverablesPath?: string;
  /** Parent profile id (used for sub-agent access to profile-scoped resources like SkillManager) */
  profileId: string;
  /**
   * 主链路 tracer —— SubAgentChat 把每一轮 `runTurn` 包成 `chat.subturn` span，
   * 复用同一 tid，psid 指向触发 spawn 的 `chat.tool` span。缺省时 sub-agent
   * 内部的 LLM / tool 日志各自独立 span，不挂主 trace 树。
   */
  tracer?: import('@shared/log/trace').Tracer;
}

