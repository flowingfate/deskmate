/**
 * 持久化层的全部 schema 类型。
 * 这里**只定义 data shape**，所有方法/操作都在 src/main/persist/ 下。
 * 不依赖任何 Node / Electron API。
 */

import type { ThinkingLevel } from '../types/thinkingLevel';
import type { AgentMcpServer as ProfileAgentMcpServer, McpServerConfig, ModelConfig, SkillConfig, SkillBindings } from '../types/profileTypes';

// ---------------------------------------------------------------------------
// profiles.json —— 跨 profile 索引
// ---------------------------------------------------------------------------

export interface ProfilesIndexFile {
  version: 1;
  activeProfileId: string;
  items: ProfileIndexEntry[];
}

export type ProfileKind = 'guest' | 'signed_in';

interface ProfileIndexEntryBase {
  id: string;                    // 'p_{ulid}'，与目录名一致
  displayName: string;
  avatar?: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface GuestProfileEntry extends ProfileIndexEntryBase {
  kind: 'guest';
}

export interface SignedInProfileEntry extends ProfileIndexEntryBase {
  kind: 'signed_in';
  authProvider: string;          // 'ghc' | ...
  authAlias: string;
}

export type ProfileIndexEntry = GuestProfileEntry | SignedInProfileEntry;

// ---------------------------------------------------------------------------
// profiles/{p_id}/settings.json —— UI 偏好
// ---------------------------------------------------------------------------

export interface SettingsFile {
  version: 1;
  confirmation?: ConfirmationSettings;
  webSearch?: WebSearchSettings;
}

export type {
  ConfirmationSettings,
  WebSearchSettings,
} from '../types/profileTypes';
import type {
  ConfirmationSettings,
  WebSearchSettings,
} from '../types/profileTypes';

// ---------------------------------------------------------------------------
// profiles/{p_id}/auth.json & auth.pi.json
// ---------------------------------------------------------------------------

/**
 * 旧 V3 `auth.json` schema —— 只供 `persist/auth.ts#LegacyAuth.load` 兼容读取
 * 磁盘上残留的老文件，无活代码再写。新登录全部走 `auth.pi.json` / `PiAuthFile`。
 */
export interface LegacyAuthFile {
  version: string;
  createdAt: string;
  updatedAt: string;
  authProvider: string;
  ghcAuth: {
    alias: string;
    /** Optional AAD account address for Azure AD–authenticated users. */
    aadAccount?: string;
    user: {
      id: string;
      login: string;
      email: string;
      name: string;
      avatarUrl: string;
      copilotPlan: 'individual' | 'business' | 'enterprise';
    };
    gitHubTokens: {
      timestamp: string;
      api_url: string;
      access_token: string;
      token_type: string;
      scope: string;
    };
    copilotTokens: {
      timestamp: string;
      api_url: string;
      /** Seconds-precision timestamp */
      expires_at: number;
      token: string;
    };
    capabilities: string[];
  };
}

/** pi-v1 auth.json schema —— 由 PiAuthManager 维护。 */
export type { PiAuthFile } from '../types/piAuthTypes';

// ---------------------------------------------------------------------------
// agents/agents.json —— 单 profile 内的 agent 注册表
// ---------------------------------------------------------------------------

export interface AgentRegistryFile {
  version: 1;
  /** primary agent id（用户偏好；删除当前 agent 时回退到此处）。指向不存在的 id 时视作未设置。 */
  primaryAgentId?: string;
  /** items 的顺序即侧边栏渲染顺序，即唯一 source of truth。 */
  items: AgentRecord[];
}



interface AgentRecordBase {
  id: string;                    // 'a_{ulid}'
  name: string;
  version: string;
  emoji?: string;
  avatar?: string;
  /**
   * 受保护标记。`true` ⇒ 该 agent 的身份(name/emoji/avatar)、system prompt
   * 不可在 UI 修改,且不可归档/删除。源真值在 AGENT.md front-matter,
   * 派生到 record(hot)供 sidebar/menu 无需 cold fetch 即可判定。缺席 ⇒ 普通可编辑 agent。
   */
  locked?: boolean;
  /**
   * 列表层就要展示（chat header、model selector），下沉到 AgentDetail 会让
   * 每个 chat header 触发一次 detail fetch；与 name/version 同等待遇。
   * 是 AGENT.md front-matter `model` 的派生缓存，patchFront 写两边。
   */
  model: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentRecord = AgentRecordBase;


// ---------------------------------------------------------------------------
// agents/{a_id}/AGENT.md —— front-matter
// ---------------------------------------------------------------------------

interface AgentMarkdownFrontBase {
  name: string;
  emoji?: string;
  avatar?: string;
  /** 受保护标记;语义同 `AgentRecordBase.locked`。AGENT.md 是源真值。 */
  locked?: boolean;
  version: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
  /**
   * 本地工具白名单(deskmate 原生)。缺席 / 空 ⇒ agent 默认享有全部本地
   * 工具;非空 ⇒ 仅列表内。与 `mcpServers` 独立(故意不对称:本地工具
   * 默认有,外部 MCP 显式集成才有)。
   */
  tools?: string[];
  mcpServers?: AgentMcpServer[];
  /**
   * Skill 启用档位映射（key = skill name，value = 档位）。单一真值，结构上
   * 保证每个 skill 只有一个档位（不会像并列数组那样出现同名分叉）：
   *   - `'live'`：元数据始终注入 system prompt。
   *   - `'lazy'`：metadata 不进 prompt；用户显式引用 URI 后，模型按稳定指引自行读取。
   *   - 不在 map 中（缺席）= 第三档禁用，`skill://` 不可读取或执行。
   * 落 AGENT.md front-matter `skills`。缺席整个字段 ⇒ 该 agent 未绑定任何 skill。
   */
  skills?: SkillBindings;
  subAgents?: string[];
  zero?: AgentZeroState;
}

/**
 * 单条预设提示词（Quick Prompt）—— 聊天空态里可点击的引导卡片。
 * 点击卡片不发送，而是把 `prompt` 填入 ComposeInput 草稿，交给用户确认后再发。
 * 落 AGENT.md front-matter `zero.preset_prompts`；跨进程共享此 wire 形态。
 */
export interface PresetPrompt {
  /** 稳定标识，React key + 持久化行主键。 */
  id: string;
  /** 卡片标题：一句话概括这条提示词做什么。 */
  title: string;
  /** 可选次级说明，展示在标题下方。 */
  description?: string;
  /** 点击后填入 ComposeInput 的完整提示词文本。 */
  prompt: string;
  /**
   * 图标 key（语义概念词，如 `write`/`search`/`code`）。renderer 经 `resolvePresetIcon`
   * 解析成 Lucide 组件并带兜底；wire 层用 `string`（shared 不依赖 renderer 的 key 集）。
   */
  iconKey: string;
}

export interface AgentZeroState {
  preset_prompts: PresetPrompt[];
}

export type AgentMarkdownFront = AgentMarkdownFrontBase;

export type AgentMcpServer = ProfileAgentMcpServer;



export interface AgentMarkdownFile {
  frontMatter: AgentMarkdownFront;
  systemPrompt: string;          // markdown body
}

/**
 * patchFront 可接受的 front-matter 字段集合（持久化层 `Agent.patchFront` 的入参）。
 * IPC 边界共用——renderer 端构造 patch 时也用此类型。
 *
 * 类型派生方式：从 AgentRecordBase（hot）与 AgentDetail（cold）各 Pick 可变字段。
 * 这样新加 AGENT.md 字段时，必须显式决定它落在 hot 还是 cold —— 编译器锁住
 * 「patch 字段 ⊂ record ∪ detail」契约。
 */
export type AgentFrontPatch =
  & Partial<Pick<AgentRecordBase, 'name' | 'version' | 'model' | 'emoji' | 'avatar' | 'locked'>>
  & Partial<Pick<AgentDetail, 'tools' | 'mcpServers' | 'skills' | 'subAgents' | 'zero'>>
  & {
    /**
     * thinkingLevel 在 patch 里是三态：
     *   - 缺席 (`undefined`)：不修改
     *   - 具体值 (`ThinkingLevel`)：写入
     *   - `null`：显式清除（回到"用 provider 默认"）
     * 区别于其它字段的"undefined = 不变" 单态。
     */
    thinkingLevel?: ThinkingLevel | null;
  };

/** agent:create IPC 入参：基础字段直传 Profile.createAgent；其余 front-matter 通过 front 一并 patch。 */
export interface CreateAgentInput {
  name: string;
  version?: string;
  model?: string;
  emoji?: string;
  avatar?: string;
  systemPrompt?: string;
  front?: AgentFrontPatch;
}

/** agent:listArchived 返回的单条目。 */
export interface ArchivedAgentEntry {
  archivedId: string;
  archivedAt: string;
  record: AgentRecord;
  markdown: AgentMarkdownFile | null;
}

/**
 * AGENT.md cold 字段集合：完整内容（systemPrompt + 所有非列表展示配置）。
 * 与 AgentRecord 互补 —— 字段不重复（id 除外，用 agentId）。
 * 取得方式：renderer 通过 persist `getAgentDetail(agentId)` 按需懒读。
 *
 * **新加字段决策**：若该字段在 sidebar / chat header 列表渲染时也需要 →
 * 加进 AgentRecordBase；只在 agent editor / chat engine 内部用 → 加这里。
 */
export interface AgentDetail {
  agentId: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt: string;
  /** 本地工具白名单;语义同 `AgentMarkdownFrontBase.tools`(默认全开)。 */
  tools?: string[];
  mcpServers?: AgentMcpServer[];
  skills?: SkillBindings;
  subAgents?: string[];
  /** 聊天空态的预设提示词（Quick Prompts）。缺席 ⇒ 未定制，renderer 回退默认播种列表。 */
  zero?: AgentZeroState;
}

// ---------------------------------------------------------------------------
// agents/{a_id}/sessions/ 的 SQLite index（profiles/{p_id}/index.db#regular_sessions）
// 取代旧 `sessions/index.json` 月级 JSON 索引。物理布局保留 `{YYYYMM}/` 物理桶，
// 仅作为 inode 数 + 备份粒度边界；查询路径不再扫月份目录。
// 设计要点见 [ai.prompt/persist.md §9.1](../../../ai.prompt/persist.md)。
// ---------------------------------------------------------------------------

interface SessionIndexEntryBase {
  id: string;                    // 's_{ulid}'
  title: string;
  createdAt: string;
  updatedAt: string;
  star?: StarMark;               // 缺席 = 未收藏；存在 = 已收藏，必有时间戳
  readStatus: 'read' | 'unread'; // 创建时默认 'unread'，无 "未知" 态
}

export interface RegularSessionIndexEntry extends SessionIndexEntryBase {
  kind: 'regular';
}

export interface ScheduleRunSessionIndexEntry extends SessionIndexEntryBase {
  kind: 'schedule_run';
  schedulerJobId: string;
}

export type SessionIndexEntry = RegularSessionIndexEntry | ScheduleRunSessionIndexEntry;

export interface StarMark {
  starredAt: string;
}

/**
 * `regular_sessions` 表行形态。`agent_id` / `month` 是 DB 内部派生缓存（路径反查用），
 * 业务层取 entry 不读这两列 —— marshal/unmarshal 在 `RegularSessionIndex` 内私有。
 *
 * 与 `RegularSessionIndexEntry` 同形 + 内部多 `agentId` / `month`：renderer 走 IPC 收到的是
 * `RegularSessionIndexEntry`（不含 agentId / month；agentId 由 IPC envelope 携带，month 不需要）。
 */
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

/**
 * `job_runs` 表行形态。展开 `ScheduleRunMeta` 三态为列（run_status / started_at / finished_at /
 * run_error）；CHECK 约束保证状态机一致性。
 */
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

/**
 * 旧 `sessions/index.json` 形态。**新 runtime 不再读写此文件**（已被 DB 取代）；
 * 类型保留**仅供** `scripts/persist-migrate/` 一次性迁移脚本继续编译。
 */
export interface SessionIndexFile {
  version: 1;
  byMonth: Record<string, SessionIndexEntry[]>;
}

// ---------------------------------------------------------------------------
// agents/{a_id}/sessions/{YYYYMM}/{s_id}/data.json
// ---------------------------------------------------------------------------

interface SessionDataFileBase {
  version: 1;
  id: string;
  agentId: string;               // 反查冗余字段：路径已隐含 agentId，但单文件导出/恢复时不丢上下文
  createdAt: string;
  updatedAt: string;
  title: string;
  /** 创建时默认 'unread'。真值落在此处；`regular_sessions.read_status` 列是派生缓存。 */
  readStatus: 'read' | 'unread';
  /** 缺席 = 未收藏。真值落在此处；`regular_sessions.starred_at` 列是派生缓存（与 row 同生共死）。 */
  star?: StarMark;
  overrides?: SessionOverrides;
  contextState: ContextState;    // 沿用旧 data.json 中的 contextState
  /**
   * 当前是否在 turn 中。`'running'` 表示上次进程退出时 turn 没收尾，启动期需调
   * planResume 续跑/标终态；缺省视作 `'idle'`。
   * 由 BaseSession 在 turn 入口/出口同步刷写（详见 ai.prompt/agent-loop.md §4.5）。
   */
  turn?: { status: 'idle' | 'running'; startedAt?: number };
}

/** 会话级 context 状态：历史压缩 + token usage。直接复用运行时形态以避免 pi/persist 类型分叉。 */
export type { ContextState } from '../types/agentChatTypes';
import type { ContextState } from '../types/agentChatTypes';

export interface RegularSessionDataFile extends SessionDataFileBase {
  kind: 'regular';
}

export interface ScheduleRunSessionDataFile extends SessionDataFileBase {
  kind: 'schedule_run';
  scheduleRun: ScheduleRunMeta;
}

export type SessionDataFile = RegularSessionDataFile | ScheduleRunSessionDataFile;

export interface SessionOverrides {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

// ---------------------------------------------------------------------------
// agents/{a_id}/sessions/{YYYYMM}/{s_id}/messages.jsonl
//
// 新设计：每行是 `PersistedJsonLine`（user / assistant / tool_res 三选一）。
// Domain Message 与 Persisted 形态的转换由 `src/main/persist/messageWire.ts`
// 的 rehydrate / dehydrate 持有；Persisted* 类型本身放在 shared 层，便于
// IPC 契约与持久化层共享，避免 shared → main 的反向依赖。
//
// 写盘约束：
//   - **常态 append-only**：tool 跑完追加 PersistedToolResponse 行；不回写老行
//   - **边缘场景全量重写**：用户编辑中段 user message → `rewriteMessages` 全量
//     dehydrate 后原子覆盖写
//   - 同 tool_call_id 多条 PersistedToolResponse = 重试历史；rehydrate 时最新一条胜出
//   - SystemMessage 不入盘（system prompt 由 buildSystemPrompt 现拼）
//   - 压缩 summary 不入盘（走 `SessionDataFile.contextState.compressions[]`）
//
// 类型派生：字段语义跟随 Domain；Persisted 只把"内存必填空数组"的字段改成
// optional，达到"空就不存"的体积效果。
// ---------------------------------------------------------------------------

import type {
  Attachment,
  AssistantMessage,
  ToolCall,
  ToolResult,
  ToolResultImage,
  UserMessage,
} from '../types/message';

/** Persisted UserMessage：空 attachments 不入盘。 */
export type PersistedUserMessage = Omit<UserMessage, 'attachments'> & {
  attachments?: Attachment[];
};

/** Persisted ToolCall：不含 response（response 单独成行，见 PersistedToolResponse）。 */
export type PersistedToolCall = Omit<ToolCall, 'response'>;

/** Persisted AssistantMessage：空 tool_calls 不入盘；ToolCall 不含 response。 */
export type PersistedAssistantMessage =
  & Omit<AssistantMessage, 'tool_calls'>
  & { tool_calls?: PersistedToolCall[] };

/**
 * Tool 结果。`id` 与上一条 AssistantMessage.tool_calls 中某项的 id 对齐。
 * 同 id 多条 = 重试历史，读取时最新一条胜出。
 */
export type PersistedToolResponse =
  & Omit<ToolResult, 'images'>
  & { role: 'tool_res'; id: string; images?: ToolResultImage[] };   // id = ToolCall.id;空 images 不入盘

export type PersistedJsonLine =
  | PersistedUserMessage
  | PersistedAssistantMessage
  | PersistedToolResponse;

/**
 * messages.jsonl 单条记录类型 ——直接 alias 到 `PersistedJsonLine`。
 *
 * Phase 5 之前曾经临时指向 `chatTypes.Message`(老 chatTypes 链路);所有
 * 消费者(pi 引擎 / persist / IPC / doctor / eval)迁到 Domain Message +
 * `PersistedJsonLine` 之后,这个 alias 就是为兼容历史命名而保留的"友好别名",
 * 与 `PersistedJsonLine` 完全等同。新代码直接写 `PersistedJsonLine` 即可。
 */
export type ChatHistoryItem = PersistedJsonLine;

// ---------------------------------------------------------------------------
// agents/{a_id}/schedules/jobs.json
// ---------------------------------------------------------------------------

export interface ScheduleJobsIndexFile {
  version: 1;
  items: ScheduleJobIndexEntry[];
}

interface ScheduleJobIndexEntryBase {
  id: string;                    // 'j_{ulid}'
  name: string;
  enabled: boolean;
  runState: JobRunState;
}

export interface OnceScheduleJobIndexEntry extends ScheduleJobIndexEntryBase {
  scheduleType: 'once';
  runAt: string;
}

export interface CronScheduleJobIndexEntry extends ScheduleJobIndexEntryBase {
  scheduleType: 'cron';
  cron: string;
}

export type ScheduleJobIndexEntry = OnceScheduleJobIndexEntry | CronScheduleJobIndexEntry;

/** job 的运行状态。状态机：pending → running → (completed|failed)。 */
export type JobRunState =
  | { status: 'pending' }
  | { status: 'running';   startedAt: string }
  | { status: 'completed'; startedAt: string; finishedAt: string }
  | { status: 'failed';    startedAt: string; finishedAt: string; error: string };

// ---------------------------------------------------------------------------
// agents/{a_id}/schedules/{j_id}/job.json
// ---------------------------------------------------------------------------

interface ScheduleJobFileBase {
  version: 1;
  id: string;
  agentId: string;
  name: string;
  description?: string;
  message: string;
  enabled: boolean;
  notifyOnCompletion?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnceScheduleJobFile extends ScheduleJobFileBase {
  scheduleType: 'once';
  runAt: string;
}

export interface CronScheduleJobFile extends ScheduleJobFileBase {
  scheduleType: 'cron';
  cron: string;
}

export type ScheduleJobFile = OnceScheduleJobFile | CronScheduleJobFile;

/**
 * 一次 schedule 执行的元数据（嵌在 ScheduleRunSessionDataFile.scheduleRun 中）。
 * 状态机：running → (completed|failed)。
 */
export type ScheduleRunMeta =
  | { jobId: string; status: 'running';   startedAt: string }
  | { jobId: string; status: 'completed'; startedAt: string; completedAt: string }
  | { jobId: string; status: 'failed';    startedAt: string; completedAt: string; error: string };

// ---------------------------------------------------------------------------
// profile 级共享资源
// ---------------------------------------------------------------------------

export interface SubAgentsIndexFile {
  version: 1;
  items: SubAgentRecord[];
}

/**
 * Sub-agent 轻量索引。最小对齐 AgentRecord（不引入 createdAt/updatedAt/avatar）。
 * id == name —— 与 Claude Code 兼容性约束（overview.md §6 不变量 5）。
 * 完整 SubAgentConfig 在 sub-agents/{id}/AGENT.md，从此处按需懒读。
 */
interface SubAgentRecordBase {
  id: string;
  name: string;
  version: string;
}

export type SubAgentRecord = SubAgentRecordBase;

export interface SkillsIndexFile {
  version: 1;
  items: SkillRecord[];
}

/**
 * skills.json 索引项。结构与 profile 层 `SkillConfig` 同构（name/description/version/foreign?），
 * 直接复用后者作为单一真值，避免同构类型多处漂移。name 与磁盘目录名一致，作为稳定 id。
 */
export type SkillRecord = SkillConfig;

export interface McpServersFile {
  version: 1;
  items: McpServerRecord[];
}

export type McpServerRecord = McpServerConfig;

export interface ModelsCacheFile {
  version: 1;
  models: ModelConfig[];
  updatedAt: string;
  count: number;
}

// ---------------------------------------------------------------------------
// 派生数据
// ---------------------------------------------------------------------------

export interface StarredSessionEntry {
  agentId: string;
  sessionId: string;
  starredAt: string;
}

// ---------------------------------------------------------------------------
// scheduler-state.json —— scheduler 运行时状态（cold-start catch-up baseline + 待补跑队列）
// ---------------------------------------------------------------------------

export interface PendingColdStartCatchUp {
  occurrenceAt: string;            // ISO，本应触发的时刻
  recordedAt: string;              // ISO，入队的时刻
}

export interface SchedulerStateFile {
  version: 1;
  isActive: boolean;
  lastActivatedAt?: string;        // ISO
  lastDeactivatedAt?: string;      // ISO
  pendingColdStartCatchUps?: Record<string, PendingColdStartCatchUp>;
}
