import type { AssistantMessage, PersistedJsonLine } from './message';
import type { ThinkingLevel } from './thinking';

/** `profiles/{p_id}/index.db#regular_sessions` 的 renderer 投影。 */
export interface RegularSessionIndexEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  star?: StarMark;
  readStatus: 'read' | 'unread';
  kind: 'regular';
}

/** 旧 `sessions/index.json` 迁移脚本使用的联合成员。 */
export interface ScheduleRunSessionIndexEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  star?: StarMark;
  readStatus: 'read' | 'unread';
  kind: 'schedule_run';
  schedulerJobId: string;
}

export type SessionIndexEntry = RegularSessionIndexEntry | ScheduleRunSessionIndexEntry;

export interface StarMark {
  starredAt: string;
}

/** `regular_sessions` 表行形态。 */
export interface RegularSessionRow {
  id: string;
  agentId: string;
  month: string;
  title: string;
  readStatus: 'read' | 'unread';
  starredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `job_runs` 表行形态。 */
export interface JobRunRow {
  id: string;
  agentId: string;
  jobId: string;
  month: string;
  title: string;
  readStatus: 'read' | 'unread';
  runStatus: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  runError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 旧 `sessions/index.json` 形态，仅供迁移脚本编译。 */
export interface SessionIndexFile {
  version: 1;
  byMonth: Record<string, SessionIndexEntry[]>;
}

/** 上下文压缩的 token 用量。 */
export interface ContextTokenUsage {
  tokenCount: number;
  totalMessages: number;
  contextMessages: number;
  compressionRatio: number;
}

/** `data.json#contextState` 的单次压缩快照。 */
export interface CompressionSnapshot {
  earlyPreservedCount: number;
  summary: AssistantMessage;
  compressedBeforeIndex: number;
  appliedAt: string;
}

/** `data.json#contextState`。 */
export interface ContextState {
  compressions: CompressionSnapshot[];
  lastTokenUsage?: ContextTokenUsage;
}

/** `data.json` 的 session 覆盖配置。 */
export interface SessionOverrides {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

interface SessionDataFileBase {
  version: 1;
  id: string;
  /** 文件迁移/导出时保留所属 agent。 */
  agentId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  readStatus: 'read' | 'unread';
  star?: StarMark;
  overrides?: SessionOverrides;
  contextState: ContextState;
  /** 进程退出时的 turn resume 标记；缺席视作 idle。 */
  turn?: { status: 'idle' | 'running'; startedAt?: number };
}

export interface RegularSessionDataFile extends SessionDataFileBase {
  kind: 'regular';
}

export interface ScheduleRunSessionDataFile extends SessionDataFileBase {
  kind: 'schedule_run';
  scheduleRun: ScheduleRunMeta;
}

export type SessionDataFile = RegularSessionDataFile | ScheduleRunSessionDataFile;

/** 一次 schedule 执行的元数据，嵌在 schedule_run `data.json` 中。 */
export type ScheduleRunMeta =
  | { jobId: string; status: 'running'; startedAt: string }
  | { jobId: string; status: 'completed'; startedAt: string; completedAt: string }
  | { jobId: string; status: 'failed'; startedAt: string; completedAt: string; error: string };

/** 导出 / 导入的单 session JSON 文件。 */
export interface ChatSessionFile {
  chatSession_id: string;
  last_updated: string;
  title: string;
  messages: PersistedJsonLine[];
  contextState: ContextState;
}

/** 从 `regular_sessions` 派生的收藏条目。 */
export interface StarredSessionEntry {
  agentId: string;
  sessionId: string;
  starredAt: string;
}

/** 旧 profile 级会话状态的执行状态。 */
export type SchedulerExecutionStatus = 'running' | 'completed' | 'failed';

export type ChatSessionReadStatus = 'read' | 'unread';

/** 旧 chat session 存储形态，保留给导入导出 IPC 契约。 */
export interface ChatSession {
  chatSession_id: string;
  last_updated: string;
  title: string;
  schedulerJobId?: string;
  schedulerExecutionStatus?: SchedulerExecutionStatus;
  schedulerStartedAt?: string;
  schedulerCompletedAt?: string;
  schedulerError?: string;
  readStatus?: ChatSessionReadStatus;
  starred?: boolean;
  starredAt?: string;
  source?: { type: 'local' } | null;
}

/** 旧 `profile.json` 的收藏会话索引。 */
export interface StarredChatSessionIndexItem {
  agentId: string;
  chatSessionId: string;
  title: string;
  lastUpdated: string;
  readStatus?: ChatSessionReadStatus;
  source?: { type: 'local' } | null;
  agentName: string;
  agentEmoji?: string;
  agentAvatar?: string;
  agentVersion?: string;
  starredAt: string;
}
