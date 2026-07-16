import type {
  SubAgentRunBlockedResult,
  SubAgentRunCancelledResult,
  SubAgentRunCompletedResult,
  SubAgentRunFailedResult,
  SubAgentRunPartialResult,
  SubrunId,
} from '../persist/types';

interface SubAgentRunStepBase {
  turn: number;
  timestamp: number;
}

export interface SubAgentTurnStartedStep extends SubAgentRunStepBase {
  kind: 'turn_started';
}

export interface SubAgentAssistantTextStep extends SubAgentRunStepBase {
  kind: 'assistant_text';
  textSnippet: string;
}

export interface SubAgentToolStartedStep extends SubAgentRunStepBase {
  kind: 'tool_started';
  toolCallId: string;
  toolName: string;
  argumentsSummary: string;
}

export interface SubAgentToolCompletedStep extends SubAgentRunStepBase {
  kind: 'tool_completed';
  toolCallId: string;
  toolName: string;
  durationMs: number;
  resultLength: number;
}

export interface SubAgentToolFailedStep extends SubAgentRunStepBase {
  kind: 'tool_failed';
  toolCallId: string;
  toolName: string;
  durationMs: number;
  error: string;
}

export type SubAgentRunStep =
  | SubAgentTurnStartedStep
  | SubAgentAssistantTextStep
  | SubAgentToolStartedStep
  | SubAgentToolCompletedStep
  | SubAgentToolFailedStep;

interface SubAgentRuntimeStateBase {
  profileId: string;
  parentAgentId: string;
  parentSessionId: string;
  subrunId: SubrunId;
  delegateAgentId: string;
  correlationId?: string;
  task: string;
  expectedOutput: string;
  maxTurns: number;
  timeoutMs: number;
  createdAt: number;
  currentTurn: number;
  steps: SubAgentRunStep[];
}

export interface SubAgentPendingRuntimeState extends SubAgentRuntimeStateBase {
  status: 'pending';
}

export interface SubAgentRunningRuntimeState extends SubAgentRuntimeStateBase {
  status: 'running';
  startedAt: number;
  lastTextSnippet?: string;
  streamingText?: string;
}

interface SubAgentTerminalRuntimeStateBase extends SubAgentRuntimeStateBase {
  startedAt: number;
  finishedAt: number;
}

export interface SubAgentCompletedRuntimeState extends SubAgentTerminalRuntimeStateBase {
  status: 'completed';
  result: SubAgentRunCompletedResult;
}

export interface SubAgentPartialRuntimeState extends SubAgentTerminalRuntimeStateBase {
  status: 'partial';
  result: SubAgentRunPartialResult;
}

export interface SubAgentBlockedRuntimeState extends SubAgentTerminalRuntimeStateBase {
  status: 'blocked';
  result: SubAgentRunBlockedResult;
}

export interface SubAgentFailedRuntimeState extends SubAgentTerminalRuntimeStateBase {
  status: 'failed';
  result: SubAgentRunFailedResult;
}

export interface SubAgentCancelledRuntimeState extends SubAgentTerminalRuntimeStateBase {
  status: 'cancelled';
  result: SubAgentRunCancelledResult;
}

export type SubAgentRuntimeState =
  | SubAgentPendingRuntimeState
  | SubAgentRunningRuntimeState
  | SubAgentCompletedRuntimeState
  | SubAgentPartialRuntimeState
  | SubAgentBlockedRuntimeState
  | SubAgentFailedRuntimeState
  | SubAgentCancelledRuntimeState;
