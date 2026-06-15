import type { ChatStatus, ContextStats } from './agentChatTypes';
import Stream from '../stream-iterator';

// ---- Base metadata ----

/** 所有 chunk 共有的路由字段 */
interface ChunkRoutingBase {
  agentId: string;
  chatSessionId: string;
  timestamp: number;
}

/** 与特定消息关联的 chunk（content / tool_call / tool_result / complete） */
interface StreamingChunkBase extends ChunkRoutingBase {
  chunkId: string;
  messageId: string;
}

// ---- Variant definitions ----

export interface ContentChunk extends StreamingChunkBase {
  type: 'content';
  text: string;
}

export interface ThinkingChunk extends StreamingChunkBase {
  type: 'thinking';
  text: string;
}

export interface ToolCallChunk extends StreamingChunkBase {
  type: 'tool_call';
  index: number;
  id: string;
  /** Tool 名称(LocalTool name 或 MCP tool name)。 */
  name: string;
  /** 完整解析后的 args 对象。主进程在 toolcall_end 一次性发完;流式期间不发增量。 */
  args: Record<string, unknown>;
  /** Tool 被调用的时间戳 (Domain ToolCall.time)。 */
  time: number;
}

export interface ToolResultChunk extends StreamingChunkBase {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  /** Tool 输出文本 (Domain ToolResult.result)。 */
  result: string;
  /** 'fail' 包括工具抛错 / tool 不存在 / 被 abort 等所有非 success 路径。 */
  status: 'success' | 'fail';
  /** 工具完成的时间戳 (Domain ToolResult.time)。 */
  time: number;
}

export interface CompleteChunk extends StreamingChunkBase {
  type: 'complete';
  hasToolCalls: boolean;
}

/** 会话状态变更，不关联具体消息，不继承 StreamingChunkBase */
export interface StatusChangedChunk extends ChunkRoutingBase {
  type: 'status_changed';
  chatStatus: ChatStatus;
  agentName?: string;
  contextStats?: ContextStats;
}

// ---- Union ----

export type StreamingChunk =
  | ContentChunk
  | ThinkingChunk
  | ToolCallChunk
  | ToolResultChunk
  | CompleteChunk
  | StatusChangedChunk;

export type { StreamingChunkBase };

export type ChunkStream = Stream<StreamingChunk>;

/**
 * Streaming state management interface
 */
export interface StreamingState {
  messageId: string;
  role: 'assistant';

  accumulatedText: string;

  accumulatedToolCalls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;

  isComplete: boolean;
}
