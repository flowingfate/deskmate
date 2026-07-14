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
  SubAgentConfig,
  ChatHistoryItem,
} from '../persist/types';

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
// 本地数据透明（/settings/persist）
// ──────────────────────────────────────────────

/**
 * profile 级共享数据的一条扁平分类（不隶属任何单一 agent）。
 * agent 私有数据（会话/定时/知识/配置）改由 `AgentStorageGroup` 承载，不在此列。
 */
export interface StorageCategory {
  /** 稳定 key（i18n / 测试断言用），不展示。 */
  key:
    | 'skills'
    | 'subAgents'
    | 'mcp'
    | 'models'
    | 'searchIndex'
    | 'archive'
    | 'profileConfig';
  /** 展示名。 */
  label: string;
  /** 一句话说明这类数据是什么。 */
  description: string;
  /** 占盘字节数（递归统计）。 */
  bytes: number;
  /** 该分类对应的磁盘绝对路径（展示 + 在文件管理器中打开）。 */
  path: string;
  /** 可选的条目计数。 */
  count?: number;
}

/** 单个 agent 分组内的一个子项（会话/定时/知识/配置）。 */
export interface AgentStoragePart {
  key: 'conversations' | 'scheduledRuns' | 'knowledge' | 'config';
  label: string;
  bytes: number;
  /** 会话数 / 定时运行数等；config、knowledge 无计数则缺席。 */
  count?: number;
  /** 该子项对应的磁盘绝对路径（reveal 用）。 */
  path: string;
}

/**
 * 一个 agent 的存储分组 —— 把该 agent 私有的会话、定时运行、知识库、配置聚合到一起，
 * 体现"agent 是一等公民"的数据组织轴心。
 */
export interface AgentStorageGroup {
  agentId: string;
  name: string;
  emoji?: string;
  avatar?: string;
  model: string;
  /** 受保护 agent（不可删）；UI 据此弱化删除入口。 */
  locked?: boolean;
  /** agent 目录绝对路径（`agents/a_xxx`），reveal 用。 */
  agentRoot: string;
  /** agent 目录递归总字节。 */
  totalBytes: number;
  /** 子项明细（按字节倒序）。 */
  parts: AgentStoragePart[];
}

/** 当前 active profile 的本地存储全景（agent 分组 + profile 级共享）。 */
export interface StorageOverview {
  profileId: string;
  profileName: string;
  profileKind: 'guest' | 'signed_in';
  /** 应用数据根目录（`~/.deskmate`）。 */
  dataRoot: string;
  /** 当前 profile 根目录（`~/.deskmate/profiles/p_xxx`）。 */
  profileRoot: string;
  /** profile 根目录递归统计的总字节数。 */
  totalBytes: number;
  /** 所有 agent 目录合计字节（= Σ agents[].totalBytes）。 */
  agentsTotalBytes: number;
  /** 按 agent 分组的私有数据（按 totalBytes 倒序）。 */
  agents: AgentStorageGroup[];
  /** profile 级共享分类（按字节倒序）。 */
  shared: StorageCategory[];
  /** 概览计数。 */
  stats: {
    agents: number;
    conversations: number;
    scheduledRuns: number;
    skills: number;
    subAgents: number;
    mcpServers: number;
    archivedAgents: number;
  };
  /** 统计生成时间（ISO）。 */
  generatedAt: string;
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
   * 懒读单个 agent 的 cold 字段（systemPrompt + thinkingLevel + knowledge + mcpServers + skills + subAgents + zero）。
   * 从 AGENT.md 解析，按 agentId 单读，不读其它 agent。agent 不存在返 null。
   * 列表层字段（name / version / emoji / avatar / model）已在 AgentRecord 中，不在本响应内重复。
   */
  getAgentDetail: { call: [agentId: string]; return: PersistResult<AgentDetail | null> };

  // ─────────── Session 写路径 ───────────
  renameSession:    { call: [agentId: string, sessionId: string, newTitle: string]; return: PersistResult };
  setSessionStarred:{ call: [agentId: string, sessionId: string, starred: boolean]; return: PersistResult };
  deleteSession:    { call: [agentId: string, sessionId: string]; return: PersistResult };
  /** 删除一条已结束的 schedule run；运行中的 run 拒绝删除，避免与执行写盘竞态。 */
  deleteScheduleRun: { call: [agentId: string, jobId: string, runId: string]; return: PersistResult };
  /** 将一条已结束的 schedule run fork 为新的 regular session；原 run 保留作调度历史。 */
  forkJobRunToSession: { call: [agentId: string, jobId: string, runId: string]; return: PersistResult<{ sessionId: string }> };
  /** 取 session 的 data.json + messages.jsonl 全量。session 不存在时返 null。 */
  getSessionMessages: { call: [agentId: string, sessionId: string]; return: PersistResult<{ data: SessionDataFile; messages: ChatHistoryItem[] } | null> };
  /** 单 agent 未读统计（regular 全量 + schedule_run 窗口内）。 */
  getUnreadSummary: { call: [agentId: string]; return: PersistResult<{ agentId: string; userUnreadCount: number; scheduledUnreadCount: number; updatedAt: string }> };

  // ─────────── Settings ───────────
  updateConfirmationSettings: { call: [settings: ConfirmationSettings]; return: PersistResult };
  updateWebSearchSettings: { call: [settings: WebSearchSettings]; return: PersistResult };

  // ─────────── 本地数据透明（/settings/persist） ───────────
  /** 汇总当前 active profile 的本地存储占用（递归统计各分类字节 + 条目计数）。 */
  getStorageOverview: { call: []; return: PersistResult<StorageOverview> };
  /** 在系统文件管理器中打开指定绝对路径（限当前 profile 目录树内）。 */
  revealStoragePath: { call: [absPath: string]; return: PersistResult };
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

  /** 单条 schedule run 被删除。 */
  'schedule:run:removed':
    { profileId: string; agentId: string; jobId: string; sessionId: string };

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
