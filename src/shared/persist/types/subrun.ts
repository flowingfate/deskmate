import type { TokenUsage } from './message';
import type { ContextState } from './session';

const SUBRUN_ID_PATTERN = /^(?!000$)[0-9]{3}$/;

/**
 * 父 session 局部序号。该类型只是持久化语义名，不是全局 ID；任何查询都必须同时携带
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

export interface SubrunSessionData {
  title: string;
  updatedAt: string;
  contextState: ContextState;
  turn?: { status: 'idle' | 'running'; startedAt?: number };
}

interface SubrunDataFileBase {
  version: 1;
  kind: 'subrun';
  subrunId: SubrunId;
  profileId: string;
  parentAgentId: string;
  parentSessionId: string;
  delegateAgentId: string;
  request: SubAgentRunRequest;
  createdAt: string;
  session: SubrunSessionData;
}

export interface PendingSubrunDataFile extends SubrunDataFileBase {
  status: 'pending';
}

export interface RunningSubrunDataFile extends SubrunDataFileBase {
  status: 'running';
  startedAt: string;
}

interface TerminalSubrunDataFileBase extends SubrunDataFileBase {
  startedAt: string;
  finishedAt: string;
}

export interface CompletedSubrunDataFile extends TerminalSubrunDataFileBase {
  status: 'completed';
  result: SubAgentRunCompletedResult;
}

export interface PartialSubrunDataFile extends TerminalSubrunDataFileBase {
  status: 'partial';
  result: SubAgentRunPartialResult;
}

export interface BlockedSubrunDataFile extends TerminalSubrunDataFileBase {
  status: 'blocked';
  result: SubAgentRunBlockedResult;
}

export interface FailedSubrunDataFile extends TerminalSubrunDataFileBase {
  status: 'failed';
  result: SubAgentRunFailedResult;
}

export interface CancelledSubrunDataFile extends TerminalSubrunDataFileBase {
  status: 'cancelled';
  result: SubAgentRunCancelledResult;
}

export type TerminalSubrunDataFile =
  | CompletedSubrunDataFile
  | PartialSubrunDataFile
  | BlockedSubrunDataFile
  | FailedSubrunDataFile
  | CancelledSubrunDataFile;

export type SubrunDataFile =
  | PendingSubrunDataFile
  | RunningSubrunDataFile
  | TerminalSubrunDataFile;
