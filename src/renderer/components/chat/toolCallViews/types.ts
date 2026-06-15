// src/renderer/components/chat/toolCallViews/types.ts
// Type definitions for Tool Call custom views

import type { ToolCall } from '@shared/types/message';

export type ToolCallExecutionStatus = 'executing' | 'completed' | 'interrupted';

// Re-export tool call arg/result types from shared for convenience
export type {
  ShellToolArgs, ShellToolResult,
  WriteToolArgs, WriteToolResult,
} from '@shared/types/toolCallArgs';

/**
 * Props interface for Tool Call custom views (Domain).
 *
 * 注:`tool_call.response` 是 Domain `ToolResult`(`{ time, status, result }`),views
 * 直接消费 `toolCall.response?.result` 取文本,不再单独传 `toolResult` 消息。
 */
export interface ToolCallViewProps {
  /** Tool Call data — 自带 response。 */
  toolCall: ToolCall;
  /** Execution state derived from the current chat session status */
  executionStatus: ToolCallExecutionStatus;
}
