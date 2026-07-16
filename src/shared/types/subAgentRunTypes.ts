import type { TokenUsage } from '../persist/types';

const SUBRUN_ID_PATTERN = /^(?!000$)[0-9]{3}$/;

/**
 * 父 session 局部序号。该类型只是共享语义名，不是全局 ID；任何查询都必须同时携带
 * profileId、parentAgentId 和 parentSessionId。
 */
export type SubrunId = string;

export function isSubrunId(value: string): boolean {
  return SUBRUN_ID_PATTERN.test(value);
}

export function parseSubrunId(value: string): number | null {
  return isSubrunId(value) ? Number(value) : null;
}

export function formatSubrunId(sequence: number): SubrunId {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new Error('Subrun sequence must be an integer between 1 and 999');
  }
  return String(sequence).padStart(3, '0');
}

export interface IsolatedSubAgentRunContext {
  kind: 'isolated';
}

export interface ParentSummarySubAgentRunContext {
  kind: 'parent_summary';
  summary: string;
}

export type SubAgentRunContext =
  | IsolatedSubAgentRunContext
  | ParentSummarySubAgentRunContext;

export interface SubAgentRunPolicy {
  maxTurns: number;
  timeoutMs: number;
}

export interface SubAgentRunRequest {
  delegateAgentId: string;
  task: string;
  expectedOutput: string;
  context: SubAgentRunContext;
  policy: SubAgentRunPolicy;
}

export interface SubAgentRunUsage {
  turns: number;
  durationMs: number;
  tokenUsage?: TokenUsage;
}

interface SubAgentRunResultBase {
  subrunId: SubrunId;
  delegateAgentId: string;
  deliverables: string[];
  warnings: string[];
  usage: SubAgentRunUsage;
}

export interface SubAgentRunCompletedResult extends SubAgentRunResultBase {
  status: 'completed';
  content: string;
}

export interface SubAgentRunPartialResult extends SubAgentRunResultBase {
  status: 'partial';
  content: string;
  incompleteReason: string;
}

export interface SubAgentRunBlockedResult extends SubAgentRunResultBase {
  status: 'blocked';
  reason: string;
  content?: string;
}

export interface SubAgentRunFailedResult extends SubAgentRunResultBase {
  status: 'failed';
  error: string;
}

export interface SubAgentRunCancelledResult extends SubAgentRunResultBase {
  status: 'cancelled';
  reason: string;
}

export type SubAgentRunResult =
  | SubAgentRunCompletedResult
  | SubAgentRunPartialResult
  | SubAgentRunBlockedResult
  | SubAgentRunFailedResult
  | SubAgentRunCancelledResult;

export type SubAgentRunStatus = SubAgentRunResult['status'];

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
