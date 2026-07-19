import type {
  ChatHistoryItem,
  ContextState,
  JobRunRow,
  PersistedAssistantMessage,
  PersistedJsonLine,
  PersistedToolResponse,
  PersistedUserMessage,
  RegularSessionDataFile,
  RegularSessionRow,
  ScheduleRunMeta,
  ScheduleRunSessionDataFile,
  SessionDataFile,
  SessionOverrides,
  StarMark,
  Message,
  ToolResult,
  SubAgentRunRequest,
  SubrunId,
} from '../../shared/persist/types';
import { MONTH_KEY, PERSIST_PATH } from '../../shared/persist/path';
import { newEntityId } from '../../shared/persist/id';
import { emit } from './lib/emit';
import { getAppRoot } from './lib/root';
import { PersistBase } from './lib/persistBase';
import type { JobRunIdx } from './lib/db/jobRunIdx';
import type { SessionIdx } from './lib/db/sessionIdx';
import { dehydrate, rehydrate } from './messageWire';
import {
  Subrun,
  type CreateSubrunResult,
  type GetSubrunResult,
  type ListSubrunsResult,
} from './subrun';
import * as fsp from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import {
  appendText,
  ensureDir,
  pathExists,
  readJsonOrNull,
  readTextOrNull,
  removeDirIfExists,
  removeFileIfExists,
  writeJson,
  writeText,
} from './lib/atomic';

type SessionKindState =
  | { kind: 'regular' }
  | { kind: 'schedule_run'; scheduleRun: ScheduleRunMeta };

const SESSION_DATA_VERSION = 1 as const;

/**
 * data.json 字段承载。`state` discriminator 与具体子类（`RegularSession` / `JobRun`）
 * 严格匹配；`assign` / `toDataFile` 内部按 `kind` 分支构造正确的 union 成员。
 * 子类构造时把 `state` 立成对应的初值，运行期不会跨形态切换。
 */
class SessionConfig {
  public title: string = '';
  public createdAt: string = '';
  public updatedAt: string = '';
  public overrides?: SessionOverrides;
  public contextState: ContextState = { compressions: [] };
  public readStatus: 'read' | 'unread' = 'unread';
  public star?: StarMark;
  /**
   * 当前是否在 turn 中。`'running'` 表示上次进程退出时 turn 没收尾，启动期需
   * 调 planResume 续跑/标终态；缺省视作 `'idle'`。
   * 由 BaseSession (pi 层) 在 turn 入口/出口同步刷写。
   */
  public turn?: { status: 'idle' | 'running'; startedAt?: number };

  public state: SessionKindState = { kind: 'regular' };

  public assign(data: SessionDataFile): void {
    this.title = data.title;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.overrides = data.overrides;
    this.contextState = data.contextState;
    this.readStatus = data.readStatus;
    this.star = data.star;
    this.turn = data.turn;
    if (data.kind === 'schedule_run') {
      this.state = { kind: 'schedule_run', scheduleRun: data.scheduleRun };
    } else {
      this.state = { kind: 'regular' };
    }
  }

  public toDataFile(id: string, agentId: string): SessionDataFile {
    const base = {
      version: SESSION_DATA_VERSION,
      id,
      agentId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      title: this.title,
      readStatus: this.readStatus,
      contextState: this.contextState,
      star: this.star,
      overrides: this.overrides,
      turn: this.turn,
    };
    if (this.state.kind === 'schedule_run') {
      const data: ScheduleRunSessionDataFile = {
        ...base,
        kind: 'schedule_run',
        scheduleRun: this.state.scheduleRun,
      };
      return data;
    }
    const data: RegularSessionDataFile = { ...base, kind: 'regular' };
    return data;
  }
}

// ---------------------------------------------------------------------------
// Session —— 抽象基类
//
// 共享 messages.jsonl 读写、files/ sandbox、节流 persist、退出 flush、
// 元数据 setter（setTitle / setReadStatus）。
//
// 路径树（dataFile / messagesFile / sessionDir / filesDir）由子类各自实现——
// 两条路径树独立，base 不知道也不需要知道哪条是哪条。
// 形态差异（load 入口、SQLite 投影、emit）同理由子类各管各的：
//   - 各子类构造时持有自己的 idx 句柄（SessionIdx / JobRunIdx）
//   - 各子类 override afterPersist() 自己 upsert + emit
// 基类完全不知道 SQLite 表 / 广播 channel 的存在。
// ---------------------------------------------------------------------------

export abstract class Session extends PersistBase {
  public readonly config = new SessionConfig();

  /** YYYYMM 月份桶；由 load / init 入口设置。 */
  public month: string = '';

  /**
   * 实例已通过 `deleteFromDisk()` 拆除。之后任何走 `persist()` 的路径都会被
   * `afterPersist()` 中的短路检查吞掉——避免在删盘后误把死引用又写回 SQLite。
   */
  private deleted = false;

  /**
   * in-memory message buffer（仅写时用作 append batch）。
   *
   * 元素类型 `ChatHistoryItem` = `PersistedJsonLine`(`shared/persist/types/index.ts`
   * 导出；Phase 5 已对齐),包含 user / assistant / `tool_res` 三种 line。
   */
  private pendingMessages: ChatHistoryItem[] = [];
  /** 串行化 flushMessages —— 并发 appendText 会破坏 jsonl 行边界。 */
  private flushing?: Promise<void>;

  constructor(
    public readonly profileId: string,
    public readonly agentId: string,
    public readonly id: string,
  ) {
    super();
  }

  // 路径四件套——子类决定挂哪棵目录树。base 只在 doPersist / flush / delete 里调。
  protected abstract dataFile(): string;
  protected abstract messagesFile(): string;
  protected abstract sessionDir(): string;
  public abstract filesDir(): string;

  /** 导出 data.json 形态。供 IPC / 跨边界传输；调用方不要直接读 `this.config.toDataFile`。 */
  public toDataFile(): SessionDataFile {
    return this.config.toDataFile(this.id, this.agentId);
  }

  /** 当前 title。owner-暴露 getter，避免外部直接读 `session.config.title`。 */
  public get title(): string {
    return this.config.title;
  }

  /** 当前 contextState。同 title，避免外部直接读 `session.config.contextState`。 */
  public get contextState(): ContextState {
    return this.config.contextState;
  }

  /** 在当前 parent session 下创建 hidden subrun；不写 session index 或 emit。 */
  public async createSubrun(request: SubAgentRunRequest): Promise<CreateSubrunResult> {
    return Subrun.create({
      profileId: this.profileId,
      parentAgentId: this.agentId,
      parentSessionId: this.id,
      subrunsDir: PERSIST_PATH.subrunsDir(this.sessionDir()),
    }, request);
  }

  /** 只在当前 parent session 下查询 subrun，禁止裸 subrunId 全局查找。 */
  public async getSubrun(subrunId: SubrunId): Promise<GetSubrunResult> {
    return Subrun.load({
      profileId: this.profileId,
      parentAgentId: this.agentId,
      parentSessionId: this.id,
      subrunsDir: PERSIST_PATH.subrunsDir(this.sessionDir()),
    }, subrunId);
  }

  /** 读取当前 parent session 的 persisted subrun metadata，不加载 transcript。 */
  public async listSubruns(): Promise<ListSubrunsResult> {
    return Subrun.list({
      profileId: this.profileId,
      parentAgentId: this.agentId,
      parentSessionId: this.id,
      subrunsDir: PERSIST_PATH.subrunsDir(this.sessionDir()),
    });
  }

  /**
   * 写 data.json（覆盖）+ flush pendingMessages + 调子类 `afterPersist`。
   * 由 PersistBase 节流：连续调用合并为一次写；写盘期间到来的新 mutate 自动进下一轮。
   *
   * 关于 updatedAt：在 mutate 方法里（setTitle/setStar 等）显式设置，不在这里碰；
   * 这样"被动消费"类操作（setReadStatus）可以不刷 updatedAt。
   */
  protected async doPersist(): Promise<void> {
    if (this.deleted) return;
    await writeJson(this.dataFile(), this.toDataFile());
    await this.flushMessages();
    this.afterPersist();
  }

  /**
   * 子类钩子：doPersist 写完盘后同步触发。
   * 子类在这里同步 SQLite index 行 + emit 广播。基类不调任何 IPC / DB。
   */
  protected abstract afterPersist(): void;

  // -------------------------------------------------------------------------
  // messages —— append-only jsonl
  // -------------------------------------------------------------------------

  /**
   * Raw `PersistedJsonLine` 入 pending buffer 的 lower-level primitive。
   *
   * **生产路径不用此方法** —— 业务调用方一律走 Domain 入口
   * `appendDomainMessage(m)` / `appendToolResponse(toolCallId, result)`,让
   * `Session` 自己负责 schema 拼装。本入口仅给:
   *   - 单元测试需要直接塞行(buffer cleanup / ghost 行 / rewriteMessages 边界
   *     等场景)
   *   - 未来导入路径一次性灌入已是 jsonl 形态的批量数据(目前导入走 rehydrate
   *     + rewriteMessages,**没**调这条)
   *
   * 不希望被业务代码扩散使用 —— 否则 Domain 层不变量(empty-array 字段必填)
   * 与 jsonl 形态(empty-array 省略)的边界会被绕过。
   */
  public appendMessage(item: ChatHistoryItem): void {
    this.pendingMessages.push(item);
  }

  /**
   * 立即把 pendingMessages 落盘。并发调用会串行化：
   * 并发的 flush / persist 调用都共用同一个 in-flight promise，避免对同一 jsonl 文件
   * 发起并行 appendFile（appendFile 跨调用非原子，多句柄交错会污染行边界）。
   */
  public async flushMessages(): Promise<void> {
    while (this.flushing) await this.flushing;
    if (this.deleted) { this.pendingMessages = []; return; }
    if (this.pendingMessages.length === 0) return;
    const batch = this.pendingMessages;
    this.pendingMessages = [];
    const text = batch.map((m) => JSON.stringify(m)).join('\n') + '\n';
    this.flushing = appendText(this.messagesFile(), text)
      .then(() => {
        emit(this.profileId, 'session:messages:appended', {
          agentId: this.agentId,
          sessionId: this.id,
          items: batch,
        });
      })
      .finally(() => { this.flushing = undefined; });
    await this.flushing;
  }

  /** 逐行读 messages.jsonl。文件不存在则空迭代。 */
  public async *streamMessages(): AsyncIterable<ChatHistoryItem> {
    const raw = await readTextOrNull(this.messagesFile());
    if (raw === null) return;
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      yield JSON.parse(line) as ChatHistoryItem;
    }
  }

  /**
   * 一次性读完 messages.jsonl 返回数组。pi.Session.restore 这类需要把全部历史
   * 灌进内存的场景用；流式消费请走 streamMessages()。
   * pendingMessages 未 flush 的部分也会拼到末尾，保证读到"逻辑上最新"的全部消息。
   */
  public async loadMessagesAll(): Promise<ChatHistoryItem[]> {
    const out: ChatHistoryItem[] = [];
    for await (const item of this.streamMessages()) out.push(item);
    if (this.pendingMessages.length > 0) out.push(...this.pendingMessages);
    return out;
  }

  /**
   * 按 offset/limit 切一段消息（基于磁盘 + pending 合并后的逻辑序列）。
   * 返回 `{ items, hasMore, nextOffset, total }`；offset 越界返回空数组。
   * 实现走全量 load —— messages.jsonl 通常 < 数千行，简单优先；后续若热再加流式 skip。
   */
  public async sliceMessages(offset: number, limit: number): Promise<{
    items: ChatHistoryItem[];
    hasMore: boolean;
    nextOffset: number;
    total: number;
  }> {
    const all = await this.loadMessagesAll();
    const start = Math.max(0, offset);
    const end = Math.max(start, Math.min(all.length, start + Math.max(0, limit)));
    const items = all.slice(start, end);
    return {
      items,
      hasMore: end < all.length,
      nextOffset: end,
      total: all.length,
    };
  }

  /**
   * 取最后 n 条消息（最常见的"初次打开 session 加载尾部"场景）。
   * 返回 `{ items, hasMore, nextOffset, total }`，offset/nextOffset 以"从头数"为准，
   * 便于后续向上翻页时直接喂给 sliceMessages。
   */
  public async tailMessages(n: number): Promise<{
    items: ChatHistoryItem[];
    hasMore: boolean;
    nextOffset: number;
    total: number;
  }> {
    const all = await this.loadMessagesAll();
    const take = Math.max(0, n);
    const start = Math.max(0, all.length - take);
    return {
      items: all.slice(start),
      hasMore: start > 0,
      nextOffset: start,
      total: all.length,
    };
  }

  /**
   * 把"磁盘 + pendingMessages 合起来的逻辑消息序列"截断到只保留前 keepCount 条。
   * keepCount<=0 → 清空（删文件 + 清 pending）。
   *
   * 实现：先 flushMessages() 把 pending 全推进磁盘，再按行裁磁盘文件。这样调用方
   * 传的 keepCount 永远代表"截断后的最终序列长度"，没有"磁盘 vs pending"的歧义。
   * pi 的 turn loop 在调 truncate 前 pendingMessages 应当总是空，多这一次 flush 在
   * 正常路径上是 no-op；防御性保留以避免后续误用导致旧 buffer 再次被 flush 回去。
   */
  public async truncateMessagesTo(keepCount: number): Promise<void> {
    await this.flushMessages();
    const file = this.messagesFile();
    const work = (async () => {
      if (keepCount <= 0) {
        await removeFileIfExists(file);
        return;
      }
      const raw = await readTextOrNull(file);
      if (raw === null) return;
      const lines = raw.split('\n').filter((l) => l.length > 0);
      if (lines.length <= keepCount) return;
      const kept = lines.slice(0, keepCount).join('\n') + '\n';
      await writeText(file, kept);
    })();
    this.flushing = work.finally(() => { this.flushing = undefined; });
    await this.flushing;
  }

  /**
   * 追加一条 tool 调用结果（`role: 'tool_res'`，对应 Phase 1 新 schema 中的
   * `PersistedToolResponse`）。语义与 `appendMessage` 完全平行 —— 同样进
   * `pendingMessages` buffer，下次 `flushMessages` 一并落盘并 emit
   * `session:messages:appended`。
   *
   * 调用入口：pi 引擎在 `handleToolCalls` 内每跑完一个 ToolCall 立即调用。
   * `toolCallId` 必须与上一条 assistant message 中某项 `tool_calls[i].id` 一致；
   * rehydrate 时按 id 折回 ToolCall.response。
   */
  public appendToolResponse(toolCallId: string, result: ToolResult): void {
    const line: PersistedToolResponse = {
      role: 'tool_res',
      id: toolCallId,
      time: result.time,
      status: result.status,
      result: result.result,
      images: result.images.length > 0 ? result.images : undefined,
    };
    this.pendingMessages.push(line);
  }

  /**
   * 把 messages.jsonl 整体重写为 `dehydrate(messages)` 的结果（原子覆盖）。
   *
   * 用于 editUserMessage / retry 这类需要中段截断 + 重新生成的场景。与
   * `flushMessages` 共享 `flushing` 锁；写完成后 emit `session:messages:rewritten`。
   *
   * 调用前 pendingMessages 若有残留先就地清掉 —— 重写后磁盘就是事实源，
   * pending buffer 中的任何遗物都不应再追加到新文件末尾。
   */
  public async rewriteMessages(messages: readonly Message[]): Promise<void> {
    while (this.flushing) await this.flushing;
    if (this.deleted) { this.pendingMessages = []; return; }
    this.pendingMessages = [];
    const lines: PersistedJsonLine[] = dehydrate(messages);
    const file = this.messagesFile();
    const work = (async () => {
      if (lines.length === 0) {
        await removeFileIfExists(file);
        return;
      }
      const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
      await writeText(file, text);
    })();
    this.flushing = work
      .then(() => {
        emit(this.profileId, 'session:messages:rewritten', {
          agentId: this.agentId,
          sessionId: this.id,
          items: lines,
        });
      })
      .finally(() => { this.flushing = undefined; });
    await this.flushing;
  }

  /**
   * 把 Domain `Message` (user / assistant) 转成 `PersistedJsonLine` 入 pending
   * buffer。**直接按 schema 构造,不绕 `dehydrate`** —— assistant 进来时若已经
   * 带了 `tool_calls[i].response`,必须由 `appendToolResponse` 单独追加 `tool_res`
   * 行;这里不展开,以免它们随 assistant 一起塞进 buffer 后被遗忘。
   *
   * 不变量:append 路径 assistant 的 `tool_calls[i].response` 应当为空 (turn loop
   * 里 `fromPiAssistantMessage` 出口天然如此)。如果调用方传进了非空 response,
   * 这里**不会**把它当 tool_res 写盘 —— 调用方必须自己再发 `appendToolResponse`,
   * 否则磁盘和内存形态裂开。
   */
  public appendDomainMessage(m: Message): void {
    if (m.role === 'user') {
      const line: PersistedUserMessage = {
        role: 'user',
        id: m.id,
        time: m.time,
        content: m.content,
      };
      if (m.attachments.length > 0) line.attachments = m.attachments;
      this.pendingMessages.push(line);
      return;
    }
    const line: PersistedAssistantMessage = {
      role: 'assistant',
      id: m.id,
      time: m.time,
      think: m.think,
      content: m.content,
    };
    if (m.tool_calls.length > 0) {
      line.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        time: tc.time,
        args: tc.args,
      }));
    }
    if (m.outcome) line.outcome = m.outcome;
    if (m.model) line.model = m.model;
    if (m.usage) line.usage = m.usage;
    this.pendingMessages.push(line);
  }

  /**
   * 读 messages.jsonl 把它折回 Domain Message 数组。pi.BaseSession.restore 调用。
   *
   * - JSON.parse 每行得到 PersistedJsonLine
   * - rehydrate 把 tool_res 折回对应 ToolCall.response
   * - `orphanResponses`:找不到匹配 ToolCall 的 tool_res(容忍旧数据脏;调用方决定 log / 丢弃)
   *
   * pendingMessages 未 flush 的部分按相同 union 形态拼到末尾 —— pi 启动期
   * `pendingMessages` 应当总是空,这里为防御性兜底。
   */
  public async loadDomainMessages(): Promise<{
    messages: Message[];
    orphanResponses: PersistedToolResponse[];
  }> {
    const raw = await readTextOrNull(this.messagesFile());
    const diskLines: PersistedJsonLine[] = [];
    if (raw !== null) {
      for (const line of raw.split('\n')) {
        if (line.length === 0) continue;
        diskLines.push(JSON.parse(line) as PersistedJsonLine);
      }
    }
    return rehydrate([...diskLines, ...this.pendingMessages]);
  }

  // -------------------------------------------------------------------------
  // 私有文件 sandbox
  // -------------------------------------------------------------------------

  public async ensureFilesDir(): Promise<void> {
    await ensureDir(this.filesDir());
  }

  // -------------------------------------------------------------------------
  // 元数据 mutate
  // -------------------------------------------------------------------------

  public async setTitle(title: string): Promise<void> {
    this.config.title = title;
    this.config.updatedAt = new Date().toISOString();
    await this.persist();
  }

  public async setReadStatus(status: 'read' | 'unread'): Promise<void> {
    this.config.readStatus = status;
    // 被动消费，不刷 updatedAt —— 防止"打开就被排到最新"。
    await this.persist();
  }

  // -------------------------------------------------------------------------
  // 删除 / 退出
  // -------------------------------------------------------------------------

  /**
   * @internal 仅供父 store（Agent.deleteSession / Agent.deleteJob）调用。
   * 标记本实例为已删除，后续走 persist 的路径都不再 upsert / emit（见 doPersist 短路）。
   */
  public async deleteFromDisk(): Promise<void> {
    this.deleted = true;
    // 删盘瞬间清掉未 flush 的消息：之后任何调用方持残留引用调 loadMessagesAll
    // 也只会得到空迭代，不会从 pending 里读出"幽灵尾巴"。
    this.pendingMessages = [];
    await removeDirIfExists(this.sessionDir());
  }

  /**
   * 进程退出前调用：把 pendingMessages flush 到磁盘。
   * 由父级 Agent.shutdown / ScheduleJob 链路触发。
   */
  public async shutdown(): Promise<void> {
    await this.flushMessages();
  }
}

// ---------------------------------------------------------------------------
// RegularSession —— 用户主对话
//
// 路径：agents/{a}/sessions/{ym}/{s}/
// 索引：regular_sessions 表（SessionIdx，构造时注入）
// emit：session:updated（afterPersist）
// 入口：Agent.getSession / Agent.createSession / Agent.copySession
// ---------------------------------------------------------------------------

export class RegularSession extends Session {
  /**
   * 加载一个 regular session。month 必须由调用方提供（一般从 sessionIndex 查）。
   */
  static async load(
    profileId: string,
    agentId: string,
    id: string,
    month: string,
    sessionIdx: SessionIdx,
  ): Promise<RegularSession | undefined> {
    const s = new RegularSession(profileId, agentId, id, sessionIdx);
    s.month = month;
    const data = await readJsonOrNull<SessionDataFile>(s.dataFile());
    if (!data || data.kind !== 'regular') return undefined;
    s.config.assign(data);
    return s;
  }

  constructor(
    profileId: string,
    agentId: string,
    id: string,
    private readonly sessionIdx: SessionIdx,
  ) {
    super(profileId, agentId, id);
  }

  protected dataFile(): string {
    return PERSIST_PATH.sessionData(getAppRoot(), this.profileId, this.agentId, this.month, this.id);
  }

  protected messagesFile(): string {
    return PERSIST_PATH.sessionMessages(getAppRoot(), this.profileId, this.agentId, this.month, this.id);
  }

  protected sessionDir(): string {
    return PERSIST_PATH.sessionDir(getAppRoot(), this.profileId, this.agentId, this.month, this.id);
  }

  public filesDir(): string {
    return PERSIST_PATH.sessionFiles(getAppRoot(), this.profileId, this.agentId, this.month, this.id);
  }

  /**
   * 初始化一个新建（未落盘）的 regular session。仅设置内部 config，不持久化、不 emit。
   * 调用方（Agent.createSession）拿到实例后再走 persist 流程。
   */
  public init(input: {
    month: string;
    title?: string;
    overrides?: SessionOverrides;
    contextState?: ContextState;
    nowIso?: string;
  }): void {
    const ts = input.nowIso ?? new Date().toISOString();
    this.month = input.month;
    this.config.title = input.title ?? '';
    this.config.createdAt = ts;
    this.config.updatedAt = ts;
    if (input.overrides) this.config.overrides = input.overrides;
    if (input.contextState) this.config.contextState = input.contextState;
  }

  /**
   * 把另一个 regular session 的内容（title 除外）作为模板套到自己上，作为"Fork"目标。
   * 不持久化、不 emit；状态变更后由调用方走正常落盘流程。
   */
  public initAsForkOf(src: RegularSession, input: { month: string; title: string; nowIso?: string }): void {
    const ts = input.nowIso ?? new Date().toISOString();
    this.month = input.month;
    // 通过 toDataFile + assign 走 owner 自己的导入接口，避免外部直接 set 字段
    this.config.assign(src.toDataFile());
    this.config.title = input.title;
    this.config.createdAt = ts;
    this.config.updatedAt = ts;
    this.config.readStatus = 'unread';
    this.config.star = undefined;
  }

  /**
   * 以一次已结束的 schedule run 建立可继续对话的 regular session。
   * 历史消息和 files 由 owner 在调用前复制；这里仅把 data.json 的共同状态投影为
   * regular 形态，刻意移除 schedule run 的状态机与任何未完成 turn 标记。
   */
  public initAsContinuationOf(
    src: SessionDataFile,
    input: { month: string; title: string; nowIso?: string },
  ): void {
    if (src.kind !== 'schedule_run') {
      throw new Error('RegularSession.initAsContinuationOf requires a schedule run source');
    }
    const ts = input.nowIso ?? new Date().toISOString();
    this.month = input.month;
    this.config.assign(src);
    this.config.state = { kind: 'regular' };
    this.config.title = input.title;
    this.config.createdAt = ts;
    this.config.updatedAt = ts;
    this.config.readStatus = 'unread';
    this.config.star = undefined;
    this.config.turn = undefined;
    this.config.contextState = {
      ...src.contextState,
      compressions: [...src.contextState.compressions],
    };
  }

  /**
   * `regular_sessions` 行投影。afterPersist 内部喂给 `SessionIdx.upsert`。
   */
  public toRegularRow(): RegularSessionRow {
    return {
      id: this.id,
      agentId: this.agentId,
      month: this.month,
      title: this.config.title,
      readStatus: this.config.readStatus,
      starredAt: this.config.star?.starredAt ?? null,
      createdAt: this.config.createdAt,
      updatedAt: this.config.updatedAt,
    };
  }

  /**
   * 标记收藏；写 data.json + afterPersist 顺手把 starred_at 写进 DB。
   * **不刷 updatedAt**：starred 是 metadata，不该把会话排到最新位置（与 setReadStatus 同语义）。
   * 上层 IPC handler `setSessionStarred` 在 setStar 后补一次 `starred:updated` 广播。
   */
  public async setStar(star: StarMark | undefined): Promise<void> {
    this.config.star = star;
    await this.persist();
  }

  /**
   * 同步 SQLite + emit。`SessionIdx.upsert` 内部会自带 emit `session:index:updated`；
   * 本方法再单独 emit 一次 `session:updated`（payload 是完整 data.json，给 renderer
   * sessionAtom 用）。
   */
  protected override afterPersist(): void {
    this.sessionIdx.upsert(this.toRegularRow());
    emit(this.profileId, 'session:updated', {
      agentId: this.agentId,
      sessionId: this.id,
      data: this.toDataFile(),
    });
  }
}

// ---------------------------------------------------------------------------
// JobRun —— 调度任务一次执行的 session 化形态
//
// 路径：agents/{a}/schedules/{j}/runs/{ym}/{s}/
// 索引：job_runs 表（JobRunIdx，构造时注入）
// emit：schedule:run:updated（afterPersist）。不发 session:updated。
// 入口：ScheduleJob.startRun / ScheduleJob.getRun / ScheduleJob.finishRun
// ---------------------------------------------------------------------------

export class JobRun extends Session {
  /**
   * 加载一次 run session。month + jobId 必须由调用方（ScheduleJob）提供。
   */
  static async load(
    profileId: string,
    agentId: string,
    id: string,
    month: string,
    jobId: string,
    jobRunIdx: JobRunIdx,
  ): Promise<JobRun | undefined> {
    const s = new JobRun(profileId, agentId, id, jobId, jobRunIdx);
    s.month = month;
    const data = await readJsonOrNull<SessionDataFile>(s.dataFile());
    if (!data || data.kind !== 'schedule_run') return undefined;
    s.config.assign(data);
    return s;
  }

  constructor(
    profileId: string,
    agentId: string,
    id: string,
    public readonly jobId: string,
    private readonly jobRunIdx: JobRunIdx,
  ) {
    super(profileId, agentId, id);
  }

  protected dataFile(): string {
    return `${this.sessionDir()}/data.json`;
  }

  protected messagesFile(): string {
    return `${this.sessionDir()}/messages.jsonl`;
  }

  protected sessionDir(): string {
    return `${PERSIST_PATH.jobRunsDir(getAppRoot(), this.profileId, this.agentId, this.jobId)}/${this.month}/${this.id}`;
  }

  public filesDir(): string {
    return `${this.sessionDir()}/files`;
  }

  /**
   * 从当前已结束的 schedule run 创建独立的 regular session。
   * 复制行为属于 source JobRun：它掌握自己的消息、sandbox 与 terminal 状态；
   * 调用者只提供目标 regular index。
   */
  public async forkToSession(sessionIdx: SessionIdx): Promise<RegularSession> {
    const source = this.toDataFile();
    if (source.kind !== 'schedule_run') {
      throw new Error(`JobRun.forkToSession: run ${this.id} kind mismatched`);
    }
    if (source.scheduleRun.status === 'running') {
      throw new Error('Cannot continue a running schedule run.');
    }

    const nowIso = new Date().toISOString();
    const month = MONTH_KEY(new Date(nowIso));
    const sessionId = newEntityId('s');
    const target = new RegularSession(this.profileId, this.agentId, sessionId, sessionIdx);
    const title = this.title ? `${this.title} (continued)` : 'Continued scheduled run';
    target.initAsContinuationOf(source, { month, title, nowIso });
    const root = getAppRoot();
    const targetDir = PERSIST_PATH.sessionDir(root, this.profileId, this.agentId, month, sessionId);

    try {
      await fsp.mkdir(targetDir, { recursive: true });
      const targetMessages = PERSIST_PATH.sessionMessages(root, this.profileId, this.agentId, month, sessionId);
      if (await pathExists(this.messagesFile())) {
        await fsp.copyFile(this.messagesFile(), targetMessages, fsConstants.COPYFILE_FICLONE);
      }
      if (await pathExists(this.filesDir())) {
        await fsp.cp(this.filesDir(), target.filesDir(), {
          recursive: true,
          mode: fsConstants.COPYFILE_FICLONE,
        });
      }
      await target.persist();
    } catch (error) {
      await removeDirIfExists(targetDir);
      throw error;
    }

    return target;
  }

  /**
   * 初始化一次新建（未落盘）的 run。仅设置内部 config。
   * 调用方是 ScheduleJob.startRun。
   */
  public init(input: { month: string; startedAt: string }): void {
    this.month = input.month;
    this.config.createdAt = input.startedAt;
    this.config.updatedAt = input.startedAt;
    this.config.state = {
      kind: 'schedule_run',
      scheduleRun: { jobId: this.jobId, status: 'running', startedAt: input.startedAt },
    };
  }

  /**
   * 标记一次 run 完成。返回 run 完成后的 `scheduleRun` meta，方便 caller 同步 job runState。
   * 状态机非法跃迁会抛错（不在 running 态会抛）。
   */
  public async finish(
    result:
      | { status: 'completed'; completedAt: string }
      | { status: 'failed'; completedAt: string; error: string },
  ): Promise<ScheduleRunMeta> {
    // 不变量：JobRun 实例的 `config.state.kind` 永远是 'schedule_run'——init / load.assign
    // 两个唯一入口都强制了这一点。下面的 narrow throw 主要为 TS 收窄类型用，runtime 不可达。
    if (this.config.state.kind !== 'schedule_run') {
      throw new Error(`JobRun.finish: run ${this.id} state.kind mismatched`);
    }
    const prev = this.config.state.scheduleRun;
    if (prev.status !== 'running') {
      throw new Error(`JobRun.finish: run ${this.id} not in running state (current: ${prev.status})`);
    }
    const meta: ScheduleRunMeta =
      result.status === 'completed'
        ? { jobId: prev.jobId, status: 'completed', startedAt: prev.startedAt, completedAt: result.completedAt }
        : { jobId: prev.jobId, status: 'failed', startedAt: prev.startedAt, completedAt: result.completedAt, error: result.error };
    this.config.state = { kind: 'schedule_run', scheduleRun: meta };
    await this.persist();
    return meta;
  }

  /**
   * `job_runs` 行投影。afterPersist 喂给 `JobRunIdx.upsert`。
   */
  public toJobRunRow(): JobRunRow {
    if (this.config.state.kind !== 'schedule_run') {
      throw new Error(`JobRun.toJobRunRow: run ${this.id} state.kind mismatched`);
    }
    const meta = this.config.state.scheduleRun;
    const finishedAt = meta.status === 'running' ? null : meta.completedAt;
    const runError = meta.status === 'failed' ? meta.error : null;
    return {
      id: this.id,
      agentId: this.agentId,
      jobId: this.jobId,
      month: this.month,
      title: this.config.title,
      readStatus: this.config.readStatus,
      runStatus: meta.status,
      startedAt: meta.startedAt,
      finishedAt,
      runError,
      createdAt: this.config.createdAt,
      updatedAt: this.config.updatedAt,
    };
  }

  /**
   * 同步 SQLite + emit `schedule:run:updated`。schedule_run 的状态广播只走这条；
   * 不发 `session:updated`（renderer sessionAtom 不订阅 schedule_run）。
   */
  protected override afterPersist(): void {
    const row = this.toJobRunRow();
    this.jobRunIdx.upsert(row);
    emit(this.profileId, 'schedule:run:updated', {
      agentId: this.agentId,
      jobId: this.jobId,
      sessionId: this.id,
      status: row.runStatus,
    });
  }
}
