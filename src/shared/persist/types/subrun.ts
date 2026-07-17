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

export type SubAgentRunContext =
  | { kind: 'isolated' }
  | {
    kind: 'parent_summary';
    summary: string;
  };

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

interface SubAgentRunResultDataBase {
  deliverables: string[];
  warnings: string[];
  usage: SubAgentRunUsage;
}

interface SubAgentRunResultDataByStatus {
  completed: SubAgentRunResultDataBase & { content: string };
  partial: SubAgentRunResultDataBase & { content: string; incompleteReason: string };
  blocked: SubAgentRunResultDataBase & { reason: string; content?: string };
  failed: SubAgentRunResultDataBase & { error: string };
  cancelled: SubAgentRunResultDataBase & { reason: string };
}

interface SubAgentRunIdentity {
  subrunId: SubrunId;
  delegateAgentId: string;
}

export type SubAgentRunStatus = keyof SubAgentRunResultDataByStatus;

export type SubAgentRunResultByStatus = {
  [Status in SubAgentRunStatus]: SubAgentRunIdentity &
    { status: Status } &
    SubAgentRunResultDataByStatus[Status];
};

export type SubAgentRunResult = SubAgentRunResultByStatus[SubAgentRunStatus];

export interface SubrunSessionData {
  title: string;
  updatedAt: string;
  contextState: ContextState;
  turn?: { status: 'idle' | 'running'; startedAt?: number };
}

export interface SubrunInitialExecution {
  kind: 'initial';
  message: string;
  expectedOutput: string;
  context: SubAgentRunContext;
  policy: SubAgentRunPolicy;
}

export interface SubrunContinuationExecution {
  kind: 'continuation';
  message: string;
  policy: SubAgentRunPolicy;
}

export type SubrunExecution = SubrunInitialExecution | SubrunContinuationExecution;

interface PersistSubrunHistoryBase {
  execution: SubrunExecution;
}

interface PersistSubrunTerminalHistoryBase extends PersistSubrunHistoryBase {
  startedAt: string;
  finishedAt: string;
}

type PersistSubrunTerminalHistory = {
  [Status in SubAgentRunStatus]: PersistSubrunTerminalHistoryBase & {
    status: Status;
    result: SubAgentRunResultDataByStatus[Status];
  };
}[SubAgentRunStatus];

export type PersistSubrunHistory =
  | (PersistSubrunHistoryBase & { status: 'pending' })
  | (PersistSubrunHistoryBase & { status: 'running'; startedAt: string })
  | PersistSubrunTerminalHistory;

export type SubrunStatus = PersistSubrunHistory['status'];

/** `subruns/{id}/data.json` 的真实磁盘形态；owner identity 由目录链提供。 */
export interface PersistSubrunDataFile {
  version: 1;
  id: SubrunId;
  delegateAgentId: string;
  histories: PersistSubrunHistory[];
  session: SubrunSessionData;
}
