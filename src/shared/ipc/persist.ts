/**
 * Persist 模块的 IPC 通道契约（仅类型）。
 *
 * 通道清单见 [ai.prompt/persist.md §6](../../../ai.prompt/persist.md)。
 * main 端 handler 由 [src/main/persist/ipc.ts](../../main/persist/ipc.ts) 注册，
 * 通过 startup pipeline 接入；renderer 端通过 `window.electronAPI.persist.invoke(...)` 调用，
 * 广播通道通过 `window.electronAPI.persist.on('persist:<channel>', cb)` 订阅。
 */

import { connectMainToRender, connectRenderToMain } from './base';
import type {
  AgentDetail,
  AgentFrontPatch,
  AgentRecord,
  ArchivedAgentEntry,
  ConfirmationSettings,
  CreateAgentInput,
  JobRunRow,
  McpServerRecord,
  RegularSessionIndexEntry,
  ScheduleJobFile,
  ScheduleJobIndexEntry,
  SessionDataFile,
  SettingsFile,
  SkillRecord,
  StarredSessionEntry,
  WebSearchSettings,
} from '../persist/types';
import type { ChatHistoryItem } from '../persist/types';
import type { SubAgentConfig } from '../types/profileTypes';

// ──────────────────────────────────────────────
// 共享 envelope
// ──────────────────────────────────────────────

export interface PersistOkResult<T = void> { success: true; data?: T }
export interface PersistErrResult        { success: false; error: string }
export type PersistResult<T = void> = PersistOkResult<T> | PersistErrResult;

// ──────────────────────────────────────────────
// Snapshot 形状（getSnapshot 返回 data，及 renderer hydrate 合流复用）
// ──────────────────────────────────────────────

export interface PersistSnapshot {
  profileId: string;
  settings: SettingsFile;
  agents: AgentRecord[];
  /** 当前 profile 的 primary agent id；缺席表示未设置。 */
  primaryAgentId?: string;
  subAgents: SubAgentConfig[];
  skills: SkillRecord[];
  mcp: McpServerRecord[];
  starred: StarredSessionEntry[];
}

// ──────────────────────────────────────────────
// Render → Main
// ──────────────────────────────────────────────

type RenderToMain = {
  /** 拉取一次性快照：active profile + agent registry (含 AGENT.md 聚合) + settings + starred。 */
  getSnapshot: {
    call: [];
    return: PersistResult<PersistSnapshot>;
  };
  switchProfile: { call: [profileId: string]; return: PersistResult };

  /** 一次性拉某 agent 全部 regular session entries（按 updatedAt 倒序）。renderer sessionIndex atom 用。 */
  listAllSessions: { call: [agentId: string]; return: PersistResult<RegularSessionIndexEntry[]> };
  /** 跨 job 聚合该 agent 所有 schedule_run（按 startedAt 倒序）。SessionPanel 的 JobRunsView 用。 */
  listAllScheduleRuns: { call: [agentId: string]; return: PersistResult<JobRunRow[]> };
  getSession:    { call: [agentId: string, sessionId: string]; return: PersistResult<SessionDataFile | null> };
  /** 返回某 session 私有文件 sandbox 的绝对路径（用于 renderer 触发 `searchFiles` 等需要 folder 绝对路径的 IPC）。session 不存在或 dir 未建时返 null。 */
  getSessionFilesDir: { call: [agentId: string, sessionId: string]; return: PersistResult<string | null> };

  // ─────────── Agent CRUD（取代老 profile.* 通道） ───────────
  /** 新建 agent；返回 agent id。 */
  createAgent: { call: [input: CreateAgentInput]; return: PersistResult<{ id: string }> };
  /** 局部更新 front-matter + 可选 systemPrompt（独立字段，避免 patch 内嵌一份 markdown body 字符串）。 */
  patchAgentFront: { call: [agentId: string, patch: AgentFrontPatch, systemPrompt?: string]; return: PersistResult };
  archiveAgent: { call: [agentId: string]; return: PersistResult };
  /** 按 agentId 取最新一条 archivedAt 的归档恢复（同 id 反复 archive/unarchive 时取最近）。 */
  unarchiveAgent: { call: [agentId: string]; return: PersistResult };
  /** 复制现有 agent 为新 agent。返回新 agent id。 */
  duplicateAgent: { call: [sourceAgentId: string, newName: string]; return: PersistResult<{ id: string }> };
  /** 设置 primary agent（传 undefined 清空）。 */
  setPrimaryAgent: { call: [agentId: string | undefined]; return: PersistResult };
  /** 列出归档 agent。 */
  listArchivedAgents: { call: []; return: PersistResult<ArchivedAgentEntry[]> };
  /**
   * 懒读单个 agent 的 cold 字段（systemPrompt + thinkingLevel + knowledge + mcpServers + skills + subAgents + zeroStates）。
   * 从 AGENT.md 解析，按 agentId 单读，不读其它 agent。agent 不存在返 null。
   * 列表层字段（name / version / emoji / avatar / model）已在 AgentRecord 中，不在本响应内重复。
   */
  getAgentDetail: { call: [agentId: string]; return: PersistResult<AgentDetail | null> };

  // ─────────── Session 写路径 ───────────
  renameSession:    { call: [agentId: string, sessionId: string, newTitle: string]; return: PersistResult };
  setSessionStarred:{ call: [agentId: string, sessionId: string, starred: boolean]; return: PersistResult };
  deleteSession:    { call: [agentId: string, sessionId: string]; return: PersistResult };
  /** 取 session 的 data.json + messages.jsonl 全量。session 不存在时返 null。 */
  getSessionMessages: { call: [agentId: string, sessionId: string]; return: PersistResult<{ data: SessionDataFile; messages: ChatHistoryItem[] } | null> };
  /** 单 agent 未读统计（regular 全量 + schedule_run 窗口内）。 */
  getUnreadSummary: { call: [agentId: string]; return: PersistResult<{ agentId: string; userUnreadCount: number; scheduledUnreadCount: number; updatedAt: string }> };

  // ─────────── Settings ───────────
  updateConfirmationSettings: { call: [settings: ConfirmationSettings]; return: PersistResult };
  updateWebSearchSettings: { call: [settings: WebSearchSettings]; return: PersistResult };
};

// ──────────────────────────────────────────────
// Main → Renderer（细粒度通知；防抖在 main 端实现）
// ──────────────────────────────────────────────

export type MainToRender = {
  /** 切换 active profile。 */
  'profile:switched':
    { profileId: string; previous: string };

  /** 共享注册表（顶层 agent registry / sub-agent / skill / mcp）改动。kind='agents' 时附 primaryAgentId。 */
  'agent:registry:updated':
    { profileId: string; kind: 'agents' | 'subAgents' | 'skills' | 'mcp'; items: unknown[]; primaryAgentId?: string };

  /**
   * 某个 agent 的 AGENT.md 改动（front + body）。同时下发：
   *   - record：列表层快照（agents.atom 用 upsert byId）
   *   - detail：完整 cold 字段（agentDetail.atom 直接更新 cache，无需再 invoke）
   * 编辑 agent 是 hot path，让已打开的 editor 立即看到更新，省一个 round-trip。
   */
  'agent:updated':
    { profileId: string; agentId: string; record: AgentRecord; detail: AgentDetail };

  /** 某个 agent 归档。 */
  'agent:removed':
    { profileId: string; agentId: string };

  /**
   * 某 agent 的 regular session 索引发生单条变化。粒度从"整月 entries 数组"切到"单条 op"
   * （详见 [ai.prompt/persist.md §6.2](../../../ai.prompt/persist.md)）。
   * - op='upsert' → `entry` 必填；renderer 按 id 合并入 atom。
   * - op='remove' → `id` 必填；renderer 按 id 剔除。
   */
  'session:index:updated':
    | { profileId: string; agentId: string; op: 'upsert'; entry: RegularSessionIndexEntry }
    | { profileId: string; agentId: string; op: 'remove'; id: string };

  /** 某个 session 的 data.json 改动。 */
  'session:updated':
    { profileId: string; agentId: string; sessionId: string; data: SessionDataFile };

  /** 流式消息追加。 */
  'session:messages:appended':
    { profileId: string; agentId: string; sessionId: string; items: unknown[] };

  /**
   * messages.jsonl 被全量重写。`rewriteMessages` 在 edit user message / retry
   * 等需要中段截断的场景下原子覆盖写 jsonl，写完即 emit。renderer 收到后应当
   * 用 `items` 整体替换该 session 的消息缓存，而不是合并。
   */
  'session:messages:rewritten':
    { profileId: string; agentId: string; sessionId: string; items: unknown[] };

  /** Schedule job 配置变化。 */
  'schedule:updated':
    { profileId: string; agentId: string; jobId: string; job: ScheduleJobFile; entry: ScheduleJobIndexEntry };

  /** Schedule job 被删除。 */
  'schedule:removed':
    { profileId: string; agentId: string; jobId: string };

  /** 单次 schedule run 状态变化。 */
  'schedule:run:updated':
    { profileId: string; agentId: string; jobId: string; sessionId: string; status: 'running' | 'completed' | 'failed' };

  /** profile 偏好变化。 */
  'settings:updated':
    { profileId: string; settings: SettingsFile };

  /** starred 列表变化。 */
  'starred:updated':
    { profileId: string; items: StarredSessionEntry[] };
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('persist');
export const mainToRender = connectMainToRender<MainToRender>('persist');
