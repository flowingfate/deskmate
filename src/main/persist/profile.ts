import type {
  AgentDetail,
  AgentRecord,
  AgentRegistryFile,
  ScheduleJobIndexEntry,
  SettingsFile,
} from '../../shared/persist/types';
import { PERSIST_PATH } from '../../shared/persist/path';
import { Agent } from './agent';
import type { ScheduleJob } from './schedule';
import { LegacyAuth, PiAuth } from './auth';
import { Mcp } from './mcp';
import { Skills } from './skills';
import { SubAgents } from './subAgents';
import { Models } from './models';
import { Archive } from './archive';
import { SchedulerState } from './schedulerState';
import { ProfileDb, unlinkProfileDb } from './lib/db/db';
import { SessionIdx } from './lib/db/sessionIdx';
import { JobRunIdx } from './lib/db/jobRunIdx';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { listDirs, pathExists, readJsonOrNull, writeJson } from './lib/atomic';
import * as fsp from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { newEntityId } from '../../shared/persist/id';
import { nowIso } from '@shared/persist/time';
import { partialAssign } from '@shared/persist/data';
import { PersistBase } from './lib/persistBase';

const SETTINGS_FILE_VERSION = 1 as const;

/** 对应 settings.json —— UI 偏好聚合。 */
class ProfileSettings extends PersistBase {
  public confirmation?: SettingsFile['confirmation'];
  public webSearch?: SettingsFile['webSearch'];

  constructor(public readonly profileId: string) {
    super();
  }

  protected async doPersist() {
    const settings = this.toFile();
    await writeJson(PERSIST_PATH.settingsFile(getAppRoot(), this.profileId), settings);
    emit('settings:updated', { profileId: this.profileId, settings });
  }

  public async update(partial: Partial<SettingsFile>) {
    // version 是文件级常量，由 toFile() 统一注入；从 partial 中剥离避免污染实例字段。
    const { version: _v, ...rest } = partial;
    const dirty = partialAssign(this, rest);
    if (!dirty) return;
    await this.persist();
  }

  public async load() {
    const settings = await readJsonOrNull<SettingsFile>(PERSIST_PATH.settingsFile(getAppRoot(), this.profileId));
    if (!settings) return;
    if (settings.confirmation !== undefined) this.confirmation = settings.confirmation;
    if (settings.webSearch !== undefined) this.webSearch = settings.webSearch;
  }

  public toFile(): SettingsFile {
    const file: SettingsFile = { version: SETTINGS_FILE_VERSION };
    if (this.confirmation !== undefined) file.confirmation = this.confirmation;
    if (this.webSearch !== undefined)   file.webSearch = this.webSearch;
    return file;
  }
}

/**
 * 对应 agents.json —— 顶层 agent 的 hot list（轻量记录 + primary 偏好）。
 * 是 AGENT.md front-matter 的派生缓存：AGENT.md 是源真值，两边偏离时以 AGENT.md 为准。
 *
 * 不管 Agent 实体本身（Map<id, Agent> 仍挂 Profile 上）；只管 agents.json 的读改写 + emit。
 * 与 ProfileSettings 同构 —— 单文件 PersistBase store。
 */
export class AgentRegistry extends PersistBase {
  public items: AgentRecord[] = [];
  public primaryAgentId: string | undefined;
  private loaded = false;

  constructor(public readonly profileId: string) {
    super();
  }

  /**
   * 幂等加载。由 `Profile.load()` 在 bootstrap 阶段并行触发；后续调用 no-op。
   * 保留幂等是为了 `AgentRegistry` 作为 public 子域的契约稳定 —— 外部万一直 call 不会重复 IO。
   */
  public async load(): Promise<void> {
    if (this.loaded) return;
    const file = await readJsonOrNull<AgentRegistryFile>(
      PERSIST_PATH.agentsIndexFile(getAppRoot(), this.profileId),
    );
    this.items = file?.items ?? [];
    this.primaryAgentId = file?.primaryAgentId;
    this.loaded = true;
  }

  /**
   * 用最新 record 替换 items 里同 id 的那行 + 落盘。
   * 由 `Agent.patchFront` 写完 AGENT.md 后回调，按"AGENT.md 是源真值"契约同步派生缓存。
   *
   * 若 id 不在 items 中（agent 已被 archive 并发删了 / 还在 createAgent 早期阶段未 push），
   * 静默跳过 —— 保守语义，避免在并发场景下复活已删 record。
   */
  public async syncRecord(record: AgentRecord): Promise<void> {
    const idx = this.items.findIndex((r) => r.id === record.id);
    if (idx < 0) return;
    this.items[idx] = record;
    await this.persist();
  }

  protected async doPersist(): Promise<void> {
    const file: AgentRegistryFile = { version: 1, items: this.items };
    if (this.primaryAgentId !== undefined) file.primaryAgentId = this.primaryAgentId;
    await writeJson(PERSIST_PATH.agentsIndexFile(getAppRoot(), this.profileId), file);
    emit('agent:registry:updated', {
      profileId: this.profileId,
      kind: 'agents',
      items: this.items,
      primaryAgentId: this.primaryAgentId,
    });
  }
}

const all = new Map<string, Profile>();

export class Profile {
  static get(id: string): Profile | undefined {
    return all.get(id);
  }

  /** 仅用于测试 / Profiles.remove() 清缓存。 */
  static evict(id: string): void {
    all.delete(id);
  }

  static async getOrLoad(id: string): Promise<Profile> {
    const cached = all.get(id);
    if (cached) return cached;

    const profile = new Profile(id);
    await profile.load();
    all.set(id, profile);
    return profile;
  }

  static shutdownAll() {
    const list: Promise<void>[] = [];
    for (const item of all) list.push(item[1].shutdown());
    return Promise.allSettled(list);
  }

  public readonly settings: ProfileSettings;
  public readonly auth:    LegacyAuth;
  public readonly piAuth:  PiAuth;

  // —— profile 级共享资源 ——
  public readonly mcp:        Mcp;
  public readonly skills:     Skills;
  public readonly subAgents:  SubAgents;
  public readonly models:     Models;
  public readonly archive:    Archive;
  public readonly schedulerState: SchedulerState;
  public readonly agentRegistry: AgentRegistry;

  /** 顶层 agent 实例缓存，懒加载。 */
  private readonly agents: Map<string, Agent> = new Map();

  /**
   * `regular_sessions` 表的读写入口（Agent + IPC handler `setSessionStarred` 共享）。
   * 取代老 `Starred` 类：starred 真值是本表的 `starred_at` 列，无独立聚合文件。
   * `setSessionStarred` IPC handler 走 `session.setStar` (写 data.json) → onChange 同步本表。
   * 不持有 `ProfileDb` 引用（每次 SQL 前自己 lookup），DB 重建后无悬空风险。
   */
  public readonly sessionIdx: SessionIdx;
  /** `job_runs` 表的读写入口；Agent + ScheduleJob 共享。 */
  public readonly jobRunIdx: JobRunIdx;

  private constructor(public readonly id: string) {
    this.settings  = new ProfileSettings(id);
    this.auth      = new LegacyAuth(id);
    this.piAuth    = new PiAuth(id);
    this.mcp       = new Mcp(id);
    this.skills    = new Skills(id);
    this.subAgents = new SubAgents(id);
    this.models    = new Models(id);
    this.archive   = new Archive(id);
    this.schedulerState = new SchedulerState(id);
    this.agentRegistry = new AgentRegistry(id);
    this.sessionIdx = new SessionIdx(id);
    this.jobRunIdx = new JobRunIdx(id);
  }

  private async load() {
    const exist = await pathExists(PERSIST_PATH.profileDir(getAppRoot(), this.id));
    if (exist) {
      await Promise.allSettled([
        this.settings.load(),
        this.auth.load(),
        this.piAuth.load(),
        this.mcp.load(),
        this.skills.load(),
        this.subAgents.load(),
        this.models.load(),
        // archive 当前无需 load
        this.schedulerState.load(),
        this.agentRegistry.load(),
      ]);
    } else {
      await this.settings.persist();
    }
    // DB 自愈/初次填充触发条件：
    //  - wasCreated：本次 open 新建 `index.db`（升级 / migrate / 用户拷贝 profile 目录），
    //    盘上可能已有 sessions 但 DB 是空表，必须扫盘补齐，否则 listSessionsFlat 空。
    //  - integrity_check fail：DB 损坏，删盘 + 重新 open + 扫盘 rebuild。
    // Index 类持有 profileId 而非 db 引用，重建后旧引用不会悬空。
    const handle = ProfileDb.open(this.id);
    let needRebuild = handle.wasCreated;
    if (!needRebuild && !handle.checkIntegrity()) {
      ProfileDb.close(this.id);
      unlinkProfileDb(this.id);
      ProfileDb.open(this.id); // 重建空 schema
      needRebuild = true;
    }
    if (needRebuild) {
      await Promise.allSettled([
        this.sessionIdx.rebuildFromDisk(),
        this.jobRunIdx.rebuildFromDisk(),
      ]);
    }
  }

  public async patchSettings(partial: Partial<SettingsFile>) {
    return this.settings.update(partial);
  }
  /**
   * 单次拉一份"profile 级 hot 数据" —— 注册表、设置、starred 等。
   * agents 字段是 AgentRecord[]（列表层），**不读任何 AGENT.md**。
   * cold 详情（systemPrompt / mcpServers / ...）通过 `getAgentDetail` 按需懒读。
   */
  public async getSnapshot() {
    return {
      profileId: this.id,
      settings: this.settings.toFile(),
      agents: this.agentRegistry.items,
      primaryAgentId: this.agentRegistry.primaryAgentId,
      subAgents: await this.subAgents.listConfigs(),
      skills: this.skills.items,
      mcp: this.mcp.items,
      starred: this.sessionIdx.listStarred(),
    };
  }

  // -------------------------------------------------------------------------
  // agents
  // -------------------------------------------------------------------------

  /**
   * 取 agent record 列表。`Profile.load()` 已在 bootstrap 阶段 preload `agentRegistry`，
   * sync 返回（含 subAgentManager / skill 等登录关键路径上的同步 lookup 调用方共用）。
   */
  public listAgents(): AgentRecord[] {
    return this.agentRegistry.items;
  }

  /**
   * 取 primaryAgentId。返回 undefined 表示未设置（与"指向不存在的 id"两种情况调用方自行 cross-check items）。
   * `Profile.load()` 已 preload，sync 返回。
   */
  public getPrimaryAgentId(): string | undefined {
    return this.agentRegistry.primaryAgentId;
  }

  public async getAgent(id: string): Promise<Agent | undefined> {
    if (this.agents.has(id)) return this.agents.get(id);
    const loaded = await Agent.load(this.id, id, this.agentRegistry, this.sessionIdx, this.jobRunIdx);
    if (loaded) this.agents.set(id, loaded);
    return loaded;
  }

  /**
   * 单 agent 懒读 cold 字段。命中不到（目录被外部删 / agent id 错）返 null。
   * 不重复 record 字段（id 用 agentId 区分边界）；renderer 端按需 join AgentRecord。
   */
  public async getAgentDetail(id: string): Promise<AgentDetail | null> {
    const agent = await this.getAgent(id);
    if (!agent) return null;
    return agent.toDetail();
  }

  /** 进程退出前调用：先 shutdown 所有已加载 Agent（flush jsonl），再关闭 SQLite 连接。 */
  public async shutdown(): Promise<void> {
    await Promise.allSettled([...this.agents.values()].map((a) => a.shutdown()));
    ProfileDb.close(this.id);
  }

  /**
   * 跨 agent 聚合 schedule job 列表。每条返回 owning agent + 已装载的 ScheduleJob 实例
   * + jobs.json 里那行 index entry（runState source of truth）。
   * scheduler 跨 agent 操作（listJobs / handleSystemResume / handleColdStartCatchUp）的唯一入口。
   */
  public async listJobsFlat(filter?: { agentId?: string }): Promise<Array<{
    agent: Agent;
    job: ScheduleJob;
    entry: ScheduleJobIndexEntry;
  }>> {
    const records = filter?.agentId
      ? this.agentRegistry.items.filter((r) => r.id === filter.agentId)
      : this.agentRegistry.items;

    const out: Array<{ agent: Agent; job: ScheduleJob; entry: ScheduleJobIndexEntry }> = [];
    for (const rec of records) {
      const agent = await this.getAgent(rec.id);
      if (!agent) continue;
      const entries = await agent.listJobs();
      for (const entry of entries) {
        const job = await agent.getJob(entry.id);
        if (job) out.push({ agent, job, entry });
      }
    }
    return out;
  }

  /**
   * 单 jobId 反查 owning agent + job 实例。
   * 走 listJobsFlat 线性查找——N agent × N job 量级小，无需 jobId→agentId 反查表。
   */
  public async findJob(jobId: string): Promise<{ agent: Agent; job: ScheduleJob } | undefined> {
    const all = await this.listJobsFlat();
    const hit = all.find((x) => x.job.id === jobId);
    return hit ? { agent: hit.agent, job: hit.job } : undefined;
  }

  public async createAgent(input: {
    name: string;
    version: string;
    model?: string;
    emoji?: string;
    avatar?: string;
    systemPrompt?: string;
  }): Promise<Agent> {
    const id = newEntityId('a');

    const agent = new Agent(this.id, id, this.agentRegistry, this.sessionIdx, this.jobRunIdx);
    agent.init({ ...input, nowIso: nowIso() });

    // 写顺序：AGENT.md → agents.json（items 尾追加即排序生效）
    // agent.persist() 内部会 emit('agent:updated')，本方法不再重复发。
    await agent.persist();
    this.agentRegistry.items.push(agent.toRecord());
    await this.agentRegistry.persist();
    this.agents.set(id, agent);
    return agent;
  }

  /**
   * 复制一个已有 agent 为新 agent（"Duplicate"）。
   * - 用 src 的 front-matter + systemPrompt 作模板，name 替换为 newName；
   * - 同步拷贝 knowledge/ 目录（如存在）；
   * - sessions / schedules **不拷贝**——产品语义是"复用 agent 配置开个新空白 agent"。
   * 返回新 Agent 实例。
   */
  public async duplicateAgent(srcId: string, newName: string): Promise<Agent> {
    const src = await this.getAgent(srcId);
    if (!src) throw new Error(`Profile.duplicateAgent: unknown agent id ${srcId}`);
    if (!newName || !newName.trim()) {
      throw new Error('Profile.duplicateAgent: newName cannot be empty');
    }

    const id = newEntityId('a');
    const ts = nowIso();

    const dst = new Agent(this.id, id, this.agentRegistry, this.sessionIdx, this.jobRunIdx);
    dst.init({
      name: newName.trim(),
      version: '1.0.0',
      model: src.config.model,
      emoji: src.config.emoji,
      avatar: src.config.avatar,
      systemPrompt: src.systemPrompt,
      nowIso: ts,
    });
    // patchFront 复制其余 front-matter 字段（thinkingLevel/mcpServers/skills/subAgents）
    // 写盘在 patchFront 内一并完成；此时 dst 还没进 agentRegistry.items，agentRegistry.syncRecord
    // 会找不到 id 而 no-op，下面 push 仍由 agentRegistry.persist 统一发 registry 事件。
    await dst.patchFront({
      thinkingLevel: src.config.thinkingLevel,
      mcpServers: src.config.mcpServers,
      skills: src.config.skills,
      subAgents: src.config.subAgents,
    });

    // 写顺序：AGENT.md（patchFront 已写）→ knowledge cp → agents.json
    const srcKnowledge = src.knowledge.path();
    const dstKnowledge = dst.knowledge.path();
    if (await pathExists(srcKnowledge)) {
      await fsp.cp(srcKnowledge, dstKnowledge, { recursive: true, mode: fsConstants.COPYFILE_FICLONE });
    }

    this.agentRegistry.items.push(dst.toRecord());
    await this.agentRegistry.persist();

    this.agents.set(id, dst);
    return dst;
  }

  /** 软删 —— 整目录移到 archive/agents/，从 agents.json 剔除（并清空 primaryAgentId 命中）。 */
  public async archiveAgent(id: string): Promise<void> {
    const recordIdx = this.agentRegistry.items.findIndex((r) => r.id === id);
    if (recordIdx < 0) throw new Error(`Profile.archiveAgent: unknown agent id ${id}`);

    // 写顺序：archive 移动 → agents.json 剔除（含 primaryAgentId 清空）
    await this.archive.archiveAgentDir(id, this.agentRegistry.items[recordIdx]);

    this.agentRegistry.items.splice(recordIdx, 1);
    if (this.agentRegistry.primaryAgentId === id) this.agentRegistry.primaryAgentId = undefined;
    await this.agentRegistry.persist();

    this.agents.delete(id);
    emit('agent:removed', { profileId: this.id, agentId: id });
  }

  /** 把 primaryAgent 改为 id（必须是已存在 agent），写盘并 emit。传入 undefined 清空。 */
  public async setPrimaryAgent(id: string | undefined): Promise<void> {
    if (id !== undefined) {
      if (!this.agentRegistry.items.some((r) => r.id === id)) {
        throw new Error(`Profile.setPrimaryAgent: unknown agent id ${id}`);
      }
    }
    if (this.agentRegistry.primaryAgentId === id) return;
    this.agentRegistry.primaryAgentId = id;
    await this.agentRegistry.persist();
  }

  public async restoreAgent(archivedId: string): Promise<void> {
    const restored = await this.archive.restoreAgentDir(archivedId);
    this.agentRegistry.items.push(restored.record);
    await this.agentRegistry.persist();
  }

  /**
   * 对账 agents.json items ↔ agents/ 目录：
   *   - items 中条目对应目录不存在 → 从 items 移除
   *   - primaryAgentId 指向的 id 不在新 items 中 → 清空
   * 不删除任何磁盘内容（保守策略）。
   * 不主动补录 "目录存在但 items 缺失" 的 agent —— 落盘时 createAgent / restoreAgent
   * 应保证 items 同步；若漂移出现，等待相关写入路径自然修复。
   */
  public async reconcileAgents(): Promise<{
    droppedFromIndex: string[];
    primaryCleared: boolean;
  }> {
    const root = getAppRoot();
    const onDisk = new Set(await listDirs(PERSIST_PATH.agentsDir(root, this.id)));

    const droppedFromIndex: string[] = [];
    const keptIndex: AgentRecord[] = [];
    for (const rec of this.agentRegistry.items) {
      if (onDisk.has(rec.id)) keptIndex.push(rec);
      else droppedFromIndex.push(rec.id);
    }

    let primaryCleared = false;
    let nextPrimary = this.agentRegistry.primaryAgentId;
    if (nextPrimary !== undefined && !keptIndex.some((r) => r.id === nextPrimary)) {
      nextPrimary = undefined;
      primaryCleared = true;
    }

    const changed = droppedFromIndex.length > 0 || primaryCleared;
    if (changed) {
      this.agentRegistry.items = keptIndex;
      this.agentRegistry.primaryAgentId = nextPrimary;
      await this.agentRegistry.persist();
    }
    return { droppedFromIndex, primaryCleared };
  }
}
