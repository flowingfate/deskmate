import type {
  AgentDetail,
  AgentFrontPatch,
  AgentMarkdownFile,
  AgentMarkdownFront,
  AgentRecord,
  AgentZeroState,
  ContextState,
  JobRunRow,
  RegularSessionIndexEntry,
  ScheduleJobFile,
  ScheduleJobIndexEntry,
  SessionOverrides,
  SkillBindings,
  ThinkingLevel,
} from '../../shared/persist/types';

export type { AgentDetail, AgentFrontPatch } from '../../shared/persist/types';

/** 分发式 Omit：对 union 的每个分支分别 Omit，保留 discriminator。 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** createJob 的入参：业务字段由调用方提供，id / agentId / 时间戳 / version 由 Agent 填充。 */
export type ScheduleJobInput = DistributiveOmit<
  ScheduleJobFile,
  'version' | 'id' | 'agentId' | 'createdAt' | 'updatedAt'
>;
import { MONTH_KEY, PERSIST_PATH } from '../../shared/persist/path';
import { parseAgentMarkdown, serializeAgentMarkdown } from '../../shared/persist/markdown';
import { newEntityId } from '../../shared/persist/id';
import { RegularSession, Session } from './session';
import * as fsp from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { AgentKnowledge } from './knowledge';
import { ScheduleJob, ScheduleRegistry } from './schedule';
import type { SessionIdx } from './lib/db/sessionIdx';
import type { JobRunIdx } from './lib/db/jobRunIdx';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { PersistBase } from './lib/persistBase';
import { readTextOrNull, removeDirIfExists, writeText } from './lib/atomic';
// `import type` 仅类型擦除，运行时不引入 ./profile，避免与 profile.ts 的 value-level `import { Agent }` 形成循环。
import type { AgentRegistry } from './profile';



/** AGENT.md front-matter 的可变状态承载。 */
class AgentConfig {
  public name: string = '';
  public version: string = '';
  public emoji?: string;
  public avatar?: string;
  public model: string = '';
  public thinkingLevel?: ThinkingLevel;
  /** 本地工具白名单(deskmate 原生);见 `AgentMarkdownFrontBase.tools`。 */
  public tools?: string[];
  public mcpServers?: AgentMarkdownFront['mcpServers'];
  public skills?: SkillBindings;
  public subAgents?: string[];
  /** 聊天空态预设提示词;见 `AgentMarkdownFrontBase.zero`。 */
  public zero?: AgentZeroState;
  /** 受保护标记;见 `AgentMarkdownFrontBase.locked`。 */
  public locked?: boolean;



  /** 用 raw front-matter 一次性覆盖所有字段。 */
  public assign(fm: AgentMarkdownFront): void {
    this.name = fm.name;
    this.version = fm.version;
    this.model = fm.model;
    this.emoji = fm.emoji;
    this.avatar = fm.avatar;
    this.thinkingLevel = fm.thinkingLevel;
    this.tools = fm.tools;
    this.mcpServers = fm.mcpServers;
    this.skills = fm.skills;
    this.subAgents = fm.subAgents;
    this.zero = fm.zero;
    this.locked = fm.locked;
  }

  /** 导出为可序列化的 front-matter 对象(仅写出非 undefined 字段)。 */
  public toFrontMatter(): AgentMarkdownFront {
    const base = {
      name: this.name,
      version: this.version,
      model: this.model,
    };
    const opt: Partial<AgentMarkdownFront> = {};
    if (this.emoji !== undefined)           opt.emoji = this.emoji;
    if (this.avatar !== undefined)          opt.avatar = this.avatar;
    if (this.thinkingLevel !== undefined) opt.thinkingLevel = this.thinkingLevel;
    if (this.tools !== undefined)           opt.tools = this.tools;
    if (this.mcpServers !== undefined)      opt.mcpServers = this.mcpServers;
    if (this.skills !== undefined) opt.skills = this.skills;
    if (this.subAgents !== undefined)       opt.subAgents = this.subAgents;
    if (this.zero !== undefined)            opt.zero = this.zero;
    if (this.locked !== undefined)          opt.locked = this.locked;

    return { ...base, ...opt };
  }
}

export class Agent extends PersistBase {
  /**
   * 从磁盘加载一个 agent；目录不存在或 AGENT.md 缺失返回 undefined。
   *
   * 需要注入：
   *  - `registry`：`patchFront` 写 AGENT.md 后回调 `syncRecord` 同步 agents.json items。
   *  - `sessionIdx`：profile 级 `regular_sessions` 表入口；本类把它继续注入给每个
   *    新建 / 加载的 `RegularSession`，由其 `afterPersist` upsert。
   *  - `jobRunIdx`：profile 级 `job_runs` 表入口；本类把它注入给每个 `ScheduleJob`，
   *    再透传给 `JobRun`，由其 `afterPersist` upsert；本类自身的 `getUnreadSummary` /
   *    `listAllScheduleRuns` / `deleteJob` 也直接读它。
   */
  static async load(
    profileId: string,
    id: string,
    registry: AgentRegistry,
    sessionIdx: SessionIdx,
    jobRunIdx: JobRunIdx,
  ): Promise<Agent | undefined> {
    const raw = await readTextOrNull(PERSIST_PATH.agentMarkdown(getAppRoot(), profileId, id));
    if (raw === null) return undefined;
    const parsed = parseAgentMarkdown(raw);
    const agent = new Agent(profileId, id, registry, sessionIdx, jobRunIdx);
    agent.config.assign(parsed.frontMatter);
    agent.systemPrompt = parsed.systemPrompt;
    // createdAt / updatedAt 不在 AGENT.md 里 —— 只挂 agents.json record。
    // 没回填会让后续 patchFront 在 toRecord() 抛 "createdAt/updatedAt not initialized"，
    // 且 doPersist 的 emit `agent:updated` 也被吞，导致 agents.json 不同步、renderer 看不到新值。
    // record 缺失（手塞目录 / agents.json 损坏）兜底当前时间，避免 throw 把整个 chain 炸掉。
    const record = registry.items.find((r) => r.id === id);
    const nowIso = new Date().toISOString();
    agent.createdAt = record?.createdAt ?? nowIso;
    agent.updatedAt = record?.updatedAt ?? nowIso;
    await agent.knowledge.ensure();
    return agent;
  }

  public readonly config = new AgentConfig();
  public readonly knowledge: AgentKnowledge;
  public readonly scheduleRegistry: ScheduleRegistry;

  public systemPrompt: string = '';
  public createdAt: string = '';
  public updatedAt: string = '';

  /** sessions / jobs 子实体的单实例缓存。in-flight 用 Promise 形式缓存以防并发重复 load。 */
  private readonly sessions: Map<string, Promise<RegularSession | undefined>> = new Map();
  private readonly jobs: Map<string, Promise<ScheduleJob | undefined>> = new Map();

  private scheduleRegistryLoading?: Promise<void>;

  constructor(
    public readonly profileId: string,
    public readonly id: string,
    /**
     * 用来在 `patchFront` 写完 AGENT.md 后回调 `syncRecord` 同步 agents.json items。
     * 用 `import type` 引入避免循环 import；运行时不依赖 Profile / AgentRegistry 的 class 值。
     */
    private readonly registry: AgentRegistry,
    /** profile 级 `regular_sessions` 表入口；透传给 RegularSession.afterPersist。 */
    public readonly sessionIdx: SessionIdx,
    /** profile 级 `job_runs` 表入口；透传给 ScheduleJob → JobRun.afterPersist；本类 getUnreadSummary/listAllScheduleRuns/deleteJob 直接读。 */
    public readonly jobRunIdx: JobRunIdx,
  ) {
    super();
    this.knowledge = new AgentKnowledge(profileId, id);
    this.scheduleRegistry = new ScheduleRegistry(profileId, id);
  }

  /**
   * 初始化一个新建（未落盘）的 agent 实例。仅设置内部 config + 时间戳；不持久化、不 emit。
   * 调用方是 Profile.createAgent —— 外层只描述"要一个 agent 长这样"，具体字段如何摆放归 Agent 自管。
   */
  public init(input: {
    name: string;
    version: string;
    model?: string;
    emoji?: string;
    avatar?: string;
    systemPrompt?: string;
    nowIso?: string;
  }): void {
    const ts = input.nowIso ?? new Date().toISOString();
    this.config.name = input.name;
    this.config.version = input.version;
    this.config.model = input.model ?? '';
    this.config.emoji = input.emoji;
    this.config.avatar = input.avatar;
    this.systemPrompt = input.systemPrompt ?? '';
    this.createdAt = ts;
    this.updatedAt = ts;
  }

  /** 当前 AGENT.md 序列化形态。供 emit 与 IPC 跨边界传输用，避免外部直接读 `config.toFrontMatter`。 */
  public toMarkdownFile(): AgentMarkdownFile {
    return {
      frontMatter: this.config.toFrontMatter(),
      systemPrompt: this.systemPrompt,
    };
  }

  /** 输出 agents.json 的索引条目。createdAt / updatedAt 必须先被填充。 */
  public toRecord(): AgentRecord {
    if (this.createdAt === '' || this.updatedAt === '') {
      throw new Error(`Agent.toRecord: createdAt/updatedAt not initialized for ${this.id}`);
    }
    return {
      id: this.id,
      name: this.config.name,
      version: this.config.version,
      emoji: this.config.emoji,
      avatar: this.config.avatar,
      model: this.config.model,
      locked: this.config.locked,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Cold 详情视图：systemPrompt + 所有非列表展示配置。
   * 与 toRecord 互补——id 用 agentId 区分边界，其余字段不重复。
   * IPC `getAgentDetail` 与 `agent:updated.detail` 都直接用此结果。
   */
  public toDetail(): AgentDetail {
    const c = this.config;
    return {
      agentId: this.id,
      thinkingLevel: c.thinkingLevel,
      systemPrompt: this.systemPrompt,
      tools: c.tools,
      mcpServers: c.mcpServers,
      skills: c.skills,
      subAgents: c.subAgents,
      zero: c.zero,
    };
  }

  /** 把 config + systemPrompt 序列化回 AGENT.md。由 PersistBase 节流。 */
  protected async doPersist(): Promise<void> {
    const file = this.toMarkdownFile();
    const raw = serializeAgentMarkdown(file);
    await writeText(PERSIST_PATH.agentMarkdown(getAppRoot(), this.profileId, this.id), raw);
    // emit 时 record 可能因 createdAt/updatedAt 尚未填充而抛 —— 仅当已初始化时发，
    // 避免早期注入路径意外炸。
    if (this.createdAt !== '' && this.updatedAt !== '') {
      emit('agent:updated', {
        profileId: this.profileId,
        agentId: this.id,
        record: this.toRecord(),
        detail: this.toDetail(),
      });
    }
  }

  /**
   * 局部更新 front-matter 字段，并立刻：
   *   1. 写盘 AGENT.md（serializeAgentMarkdown）
   *   2. 回调 `registry.syncRecord(this.toRecord())` 同步 agents.json items
   *
   * 写顺序按"AGENT.md 是源真值"契约：先写 AGENT.md，再同步派生缓存 record。
   * 崩溃在中间 → 下次启动 record 仍是旧值；可选 reconcile 修复。
   *
   * updatedAt 始终刷新到 patchFront 调用时刻。
   */
  public async patchFront(partial: AgentFrontPatch): Promise<void> {
    const c = this.config;
    if (partial.name !== undefined)            c.name = partial.name;
    if (partial.version !== undefined)         c.version = partial.version;

    // ── model 与 thinkingLevel 联动 ──
    // pi-ai 的 thinkingLevelMap 是 per-model 的：'high'/'minimal'/'xhigh' 在不同
    // model 下要么不支持、要么含义不同（OpenAI 的 high ≠ Claude 的 high，对应的
    // token budget 完全不一样）。所以切 model 等同于"reasoning 上下文重置"，旧
    // thinkingLevel 不能跟着继承——否则 pi-ai 会 clampThinkingLevel 静默兜底，UI
    // 显示 "Auto"、runtime 实际发的是 clamp 后的等级，行为不一致。
    //
    // 优先级：同一个 patch 里如果显式给了 thinkingLevel（含 null=清除），以显式
    // 意图为准——这是调用方的语义，invariant 不该覆盖它。下面 thinkingLevel 分支
    // 在最后处理，所以这里把"切 model 时的兜底清"放在前面是安全的：显式 patch
    // 仍会在后面把字段覆盖回去。
    const modelChanged = partial.model !== undefined && partial.model !== c.model;
    if (partial.model !== undefined) c.model = partial.model;
    if (modelChanged && partial.thinkingLevel === undefined) {
      c.thinkingLevel = undefined;
    }

    if (partial.emoji !== undefined)           c.emoji = partial.emoji;
    if (partial.avatar !== undefined)          c.avatar = partial.avatar;
    // thinkingLevel 三态：undefined=不改 / null=清除 / 具体值=写入
    if (partial.thinkingLevel !== undefined)   c.thinkingLevel = partial.thinkingLevel ?? undefined;
    if (partial.tools !== undefined)           c.tools = partial.tools;
    if (partial.mcpServers !== undefined)      c.mcpServers = partial.mcpServers;
    if (partial.skills !== undefined)          c.skills = partial.skills;
    if (partial.subAgents !== undefined)       c.subAgents = partial.subAgents;
    if (partial.zero !== undefined)            c.zero = partial.zero;
    if (partial.locked !== undefined)          c.locked = partial.locked;

    this.updatedAt = new Date().toISOString();
    await this.persist();
    await this.registry.syncRecord(this.toRecord());
  }

  /** 移除磁盘目录（由 Profile.archiveAgent 在归档完成后调用）。 */
  public async deleteFromDisk(): Promise<void> {
    await removeDirIfExists(PERSIST_PATH.agentDir(getAppRoot(), this.profileId, this.id));
  }

  /**
   * 进程退出前调用：遍历已加载到内存的 RegularSession 实例，逐个 shutdown。
   * 内部 Map 存的是 Promise<RegularSession | undefined>，要 await 解包；load 失败（undefined）跳过。
   */
  public async shutdown(): Promise<void> {
    const settled = await Promise.all(this.sessions.values());
    const sessions = settled.filter((s): s is RegularSession => s !== undefined);
    await Promise.allSettled(sessions.map((s) => s.shutdown()));
  }

  // -------------------------------------------------------------------------
  // sessions
  // -------------------------------------------------------------------------

  /**
   * 取 regular session。Agent 只管 regular —— schedule_run 形态的 session 通过
   * `Agent.getJob(jobId).getRun(id)` 拿，物理布局与本路径独立。
   */
  public async getSession(id: string): Promise<RegularSession | undefined> {
    let pending = this.sessions.get(id);
    if (pending) return pending;
    pending = (async () => {
      const row = this.sessionIdx.findById(id);
      if (!row) return undefined;
      const loaded = await RegularSession.load(this.profileId, this.id, id, row.month, this.sessionIdx);
      return loaded;
    })();
    this.sessions.set(id, pending);
    const loaded = await pending;
    if (!loaded) this.sessions.delete(id);
    return loaded;
  }

  /**
   * 跨形态查 session：先按 regular 找，未命中再回落到 job_runs 索引。
   *
   * 给 URI 解析层（`local://` handler）/ session-files IPC 这类**不关心 session 物理
   * 来源**的入口用 —— 调用方持有的 sessionId 既可能是 RegularSession 也可能是 JobRun
   * (调度任务 turn loop 注入的 ToolContext.sessionId 就是后者)。两条物理布局
   * (`agents/{a}/sessions/{ym}/{s}/` vs `agents/{a}/schedules/{j}/runs/{ym}/{s}/`)
   * 仍然各自独立，本方法只负责"按 id 把 Session 找出来"，不混淆下游。
   *
   * 命中顺序：sessionIdx → jobRunIdx。两个表互斥（id 命名空间是同 ULID 池但不同 SQLite
   * 表），不会有歧义。
   */
  public async findSessionAcrossKinds(id: string): Promise<Session | undefined> {
    const regular = await this.getSession(id);
    if (regular) return regular;
    const row = this.jobRunIdx.findById(id);
    if (!row) return undefined;
    // jobRunIdx 行包含 jobId / month —— 用它走 ScheduleJob.getRun 的标准缓存通道。
    const job = await this.getJob(row.jobId);
    if (!job) return undefined;
    return job.getRun(id);
  }

  public async createSession(input: {
    id?: string;
    title?: string;
    overrides?: SessionOverrides;
    contextState?: ContextState;
  } = {}): Promise<RegularSession> {
    // 允许外部传入 id：renderer 端在"new chat"按钮点击时就用 newEntityId('s') 生成 id 占位
    // 并 navigate，但直到首次 streamMessage 走 pi.Agent.getOrCreateSession 才真正落盘。
    // 此时持久化的 id 必须与 renderer 持有的一致。
    const id = input.id ?? newEntityId('s');
    const nowIso = new Date().toISOString();
    const session = new RegularSession(this.profileId, this.id, id, this.sessionIdx);
    session.init({
      month: MONTH_KEY(new Date(nowIso)),
      title: input.title,
      overrides: input.overrides,
      contextState: input.contextState,
      nowIso,
    });
    // 首次 persist 触发 RegularSession.afterPersist → sessionIdx.upsert + emit session:updated。
    await session.persist();
    this.sessions.set(id, Promise.resolve(session));
    return session;
  }

  public async deleteSession(id: string): Promise<boolean> {
    const session = await this.getSession(id);
    if (!session) return false;
    // 先摘 DB 行，再删盘：中断态最多剩孤儿目录（rebuild 可清），不会出现 "DB 列出但
    // data.json 已不存在" 的死引用。SessionIdx.remove 内部 emit `session:index:updated`(op='remove')。
    // session.deleteFromDisk() 内部把实例标记 deleted，之后任何 persist 都会被 afterPersist
    // 短路掉——所以即使有手在调用方那里残留引用并误调 persist，也不会复活 DB 行。
    this.sessionIdx.remove(id);
    await session.deleteFromDisk();
    this.sessions.delete(id);
    return true;
  }

  /**
   * 跨月聚合 regular session 列表（按 updatedAt 倒序）。
   * SQL 直查 `regular_sessions`，索引 `ix_regular_agent_updated` 命中；无需扫盘。
   * `kind` 只接受 'regular'（schedule_run 走 `listAllScheduleRuns`）；保留入参为了 IPC 契约稳定。
   */
  public async listSessionsFlat(_opts: { kind?: 'regular' } = {}): Promise<RegularSessionIndexEntry[]> {
    const rows = this.sessionIdx.listAgent(this.id);
    return rows.map((row): RegularSessionIndexEntry => {
      const entry: RegularSessionIndexEntry = {
        kind: 'regular',
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        readStatus: row.readStatus,
      };
      if (row.starredAt !== null) entry.star = { starredAt: row.starredAt };
      return entry;
    });
  }

  /**
   * 未读计数。regular 全量统计；schedule_run 仅算窗口内（默认 5 天）。
   * 走两条 SQL：
   *  - `regularSessionIndex.countUnread(agentId)` 命中偏序索引 `ix_regular_agent_unread`。
   *  - `jobRunIndex.countUnread(agentId, sinceIso)` 命中偏序索引 `ix_runs_agent_unread`，
   *    窗口下界 `sinceIso = (now - windowMs).toISOString()`。
   * 旧 fan-out 扫盘路径已删除。
   */
  public async getUnreadSummary(
    opts: { scheduledWindowMs?: number; nowMs?: number } = {},
  ): Promise<{ agentId: string; userUnreadCount: number; scheduledUnreadCount: number; updatedAt: string }> {
    const windowMs = opts.scheduledWindowMs ?? 5 * 24 * 60 * 60 * 1000;
    const nowMs = opts.nowMs ?? Date.now();
    const userUnreadCount = this.sessionIdx.countUnread(this.id);
    const sinceIso = new Date(nowMs - windowMs).toISOString();
    const scheduledUnreadCount = this.jobRunIdx.countUnread(this.id, sinceIso);
    return {
      agentId: this.id,
      userUnreadCount,
      scheduledUnreadCount,
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  /**
   * 拷贝一个 regular session 为新 session（"Fork"）。
   * 仅拷贝 data.json + messages.jsonl + files/（如存在）；新 id 由本方法生成。
   * schedule_run 无法 fork（语义不对）—— 传入返回 undefined。
   */
  public async copySession(srcId: string): Promise<RegularSession | undefined> {
    const src = await this.getSession(srcId);
    if (!src) return undefined;

    const newId = newEntityId('s');
    const month = MONTH_KEY(new Date());
    const root = getAppRoot();

    // 1) 物理 cp src 目录到 dst（带 messages.jsonl + files/ 一并搬走）。
    //    data.json 也会被拷过来，但下一步 dst.persist() 会立即用新 id/title 覆写。
    const srcDir = PERSIST_PATH.sessionDir(root, this.profileId, this.id, src.month, src.id);
    const dstDir = PERSIST_PATH.sessionDir(root, this.profileId, this.id, month, newId);
    await fsp.cp(srcDir, dstDir, { recursive: true, mode: fsConstants.COPYFILE_FICLONE });

    // 2) 用 RegularSession.initAsForkOf 写状态，persist 会 afterPersist → sessionIdx.upsert + emit。
    const title = src.title ? `${src.title} (Fork)` : 'New Chat (Fork)';
    const dst = new RegularSession(this.profileId, this.id, newId, this.sessionIdx);
    dst.initAsForkOf(src, { month, title });
    await dst.persist();

    this.sessions.set(newId, Promise.resolve(dst));
    return dst;
  }

  // -------------------------------------------------------------------------
  // schedules
  // -------------------------------------------------------------------------

  private async loadScheduleRegistry(): Promise<void> {
    this.scheduleRegistryLoading ??= this.scheduleRegistry.load();
    await this.scheduleRegistryLoading;
  }

  private bindJobOnChange(job: ScheduleJob): void {
    job.onChange = async () => {
      await this.loadScheduleRegistry();
      const entry = job.toIndexEntry();
      await this.scheduleRegistry.upsert(entry);
      emit('schedule:updated', {
        profileId: this.profileId,
        agentId: this.id,
        jobId: job.id,
        job: job.toFile(),
        entry,
      });
    };
  }

  public async listJobs(): Promise<ScheduleJobIndexEntry[]> {
    await this.loadScheduleRegistry();
    return this.scheduleRegistry.items;
  }

  public async getJob(id: string): Promise<ScheduleJob | undefined> {
    let pending = this.jobs.get(id);
    if (pending) return pending;
    pending = (async () => {
      const loaded = await ScheduleJob.load(this.profileId, this.id, id, this.jobRunIdx);
      if (!loaded) return undefined;
      // runState 是 jobs.json 索引的 source of truth，merge 回 job 实例
      await this.loadScheduleRegistry();
      const entry = this.scheduleRegistry.get(id);
      if (entry) loaded.mergeRunStateFromIndex(entry.runState);
      this.bindJobOnChange(loaded);
      return loaded;
    })();
    this.jobs.set(id, pending);
    const loaded = await pending;
    if (!loaded) this.jobs.delete(id);
    return loaded;
  }

  public async createJob(input: ScheduleJobInput): Promise<ScheduleJob> {
    await this.loadScheduleRegistry();
    const id = newEntityId('j');
    const ts = new Date().toISOString();
    // 分发到 union 两个分支，避免一次性 spread 触发 union 推导塌成 never。
    const file: ScheduleJobFile = input.scheduleType === 'cron'
      ? { ...input, version: 1, id, agentId: this.id, createdAt: ts, updatedAt: ts }
      : { ...input, version: 1, id, agentId: this.id, createdAt: ts, updatedAt: ts };
    const job = new ScheduleJob(this.profileId, this.id, id, this.jobRunIdx);
    job.assign(file);
    this.bindJobOnChange(job);
    // 首次 persist → onChange → registry upsert。
    await job.persist();
    this.jobs.set(id, Promise.resolve(job));
    return job;
  }

  /**
   * 跨 job 聚合该 agent 所有 schedule_run（按 startedAt 倒序）。SQL 直查 `job_runs`，
   * 索引 `ix_runs_agent_started` 命中；旧 fan-out 扫盘已删。
   * 返回 `JobRunRow[]` —— 与旧 `ScheduleRunSessionDataFile[]` 相比丢了 `contextState`/`overrides`/
   * `version`/`agentId`（路径已隐含）等 IPC 不需要的字段，命中 renderer 真正消费的字段子集。
   */
  public async listAllScheduleRuns(): Promise<JobRunRow[]> {
    return this.jobRunIdx.listAgentRuns(this.id);
  }

  /**
   * 删 job：先摘 jobs.json 索引行 → 清 `job_runs` 表内该 job 的所有 run → 递归删盘。
   * `jobRunIndex.removeByJob` 不 emit；renderer atom 走 `schedule:removed` 全量 reload。
   */
  public async deleteJob(id: string): Promise<void> {
    const job = await this.getJob(id);
    if (!job) return;
    job.onChange = undefined;
    await this.loadScheduleRegistry();
    await this.scheduleRegistry.remove(id);
    this.jobRunIdx.removeByJob(id);
    await job.deleteFromDisk();
    this.jobs.delete(id);
    emit('schedule:removed', {
      profileId: this.profileId,
      agentId: this.id,
      jobId: id,
    });
  }
}
