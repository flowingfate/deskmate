import type {
  CronScheduleJobFile,
  CronScheduleJobIndexEntry,
  JobRunRow,
  JobRunState,
  OnceScheduleJobFile,
  OnceScheduleJobIndexEntry,
  ScheduleJobFile,
  ScheduleJobIndexEntry,
  ScheduleJobsIndexFile,
} from '../../shared/persist/types';
import { MONTH_KEY, PERSIST_PATH } from '../../shared/persist/path';
import { newEntityId } from '../../shared/persist/id';
import { JobRun } from './session';
import { getAppRoot } from './lib/root';
import { emit } from './lib/emit';
import { PersistBase } from './lib/persistBase';
import type { JobRunIdx } from './lib/db/jobRunIdx';
import {
  readJsonOrNull,
  removeDirIfExists,
  writeJson,
} from './lib/atomic';

const SCHEDULE_JOB_FILE_VERSION = 1 as const;
const SCHEDULE_JOBS_INDEX_VERSION = 1 as const;

type ScheduleSpec =
  | { kind: 'once'; runAt: string }
  | { kind: 'cron'; cron: string };

/** ScheduleJob.applyUpdate 接受的部分字段。schedule 替换是整 union 替换。 */
export type ScheduleJobUpdate = Partial<{
  name: string;
  description: string;
  message: string;
  enabled: boolean;
  notifyOnCompletion: boolean;
  schedule: ScheduleSpec;
}>;

// ScheduleRunSummary 类型已删除（Step 9）—— `listRunsOnDisk` 直接返 `JobRunRow[]`。
function specFromFile(file: ScheduleJobFile): ScheduleSpec {
  if (file.scheduleType === 'cron') return { kind: 'cron', cron: file.cron };
  return { kind: 'once', runAt: file.runAt };
}

class ScheduleJobConfig {
  public name: string = '';
  public description?: string;
  public message: string = '';
  public enabled: boolean = true;
  public notifyOnCompletion?: boolean;
  public createdAt: string = '';
  public updatedAt: string = '';

  public schedule: ScheduleSpec = { kind: 'once', runAt: '' };
  public runState: JobRunState = { status: 'pending' };

  public assign(file: ScheduleJobFile): void {
    this.name = file.name;
    this.description = file.description;
    this.message = file.message;
    this.enabled = file.enabled;
    this.notifyOnCompletion = file.notifyOnCompletion;
    this.createdAt = file.createdAt;
    this.updatedAt = file.updatedAt;
    this.schedule = specFromFile(file);
  }

  /**
   * 批量字段更新。schedule kind 可以切换（cron ↔ once），但调用方必须把对应字段（cron / runAt）也一起给齐。
   * 缺字段会抛错，避免半残状态。
   */
  public applyUpdate(partial: ScheduleJobUpdate): void {
    if (partial.name !== undefined)              this.name = partial.name;
    if (partial.description !== undefined)       this.description = partial.description;
    if (partial.message !== undefined)           this.message = partial.message;
    if (partial.enabled !== undefined)           this.enabled = partial.enabled;
    if (partial.notifyOnCompletion !== undefined) this.notifyOnCompletion = partial.notifyOnCompletion;

    if (partial.schedule) {
      if (partial.schedule.kind === 'cron') {
        if (!partial.schedule.cron) {
          throw new Error('ScheduleJobConfig.applyUpdate: cron required when kind=cron');
        }
        this.schedule = { kind: 'cron', cron: partial.schedule.cron };
      } else {
        if (!partial.schedule.runAt) {
          throw new Error('ScheduleJobConfig.applyUpdate: runAt required when kind=once');
        }
        this.schedule = { kind: 'once', runAt: partial.schedule.runAt };
      }
    }
    this.updatedAt = new Date().toISOString();
  }

  public toFile(id: string, agentId: string): ScheduleJobFile {
    const common = {
      version: SCHEDULE_JOB_FILE_VERSION,
      id,
      agentId,
      name: this.name,
      message: this.message,
      enabled: this.enabled,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      description: this.description,
      notifyOnCompletion: this.notifyOnCompletion,
    };
    if (this.schedule.kind === 'cron') {
      const file: CronScheduleJobFile = { ...common, scheduleType: 'cron', cron: this.schedule.cron };
      return file;
    }
    const file: OnceScheduleJobFile = { ...common, scheduleType: 'once', runAt: this.schedule.runAt };
    return file;
  }
}

export class ScheduleJob extends PersistBase {
  /**
   * 注入 `jobRunIdx` —— `startRun` / `getRun` / `listRunsOnDisk` / `finishRun` 全部经过它写
   * `job_runs` 表（Step 9 起）；扫盘 fan-out 路径已删。
   */
  static async load(
    profileId: string,
    agentId: string,
    id: string,
    jobRunIdx: JobRunIdx,
  ): Promise<ScheduleJob | undefined> {
    const root = getAppRoot();
    const file = await readJsonOrNull<ScheduleJobFile>(PERSIST_PATH.jobFile(root, profileId, agentId, id));
    if (!file) return undefined;
    const job = new ScheduleJob(profileId, agentId, id, jobRunIdx);
    job.config.assign(file);
    return job;
  }

  public readonly config = new ScheduleJobConfig();

  /** runs 是 session 的特化形态，按月归档。 */
  private readonly runs: Map<string, JobRun> = new Map();

  /**
   * 持久化完成后回调；由 Agent 注入，用于同步 jobs.json#items[].runState。
   */
  public onChange?: () => Promise<void> | void;

  constructor(
    public readonly profileId: string,
    public readonly agentId: string,
    public readonly id: string,
    private readonly jobRunIdx: JobRunIdx,
  ) {
    super();
  }

  /** 当前 job.json 序列化形态。供 emit 与 IPC 跨边界传输用。 */
  public toFile(): ScheduleJobFile {
    return this.config.toFile(this.id, this.agentId);
  }

  /** 把外部 update payload 应用到 config 上，写盘由调用方负责。 */
  public applyUpdate(partial: ScheduleJobUpdate): void {
    this.config.applyUpdate(partial);
  }

  public toIndexEntry(): ScheduleJobIndexEntry {
    const base = {
      id: this.id,
      name: this.config.name,
      enabled: this.config.enabled,
      runState: this.config.runState,
    };
    if (this.config.schedule.kind === 'cron') {
      const entry: CronScheduleJobIndexEntry = {
        ...base, scheduleType: 'cron', cron: this.config.schedule.cron,
      };
      return entry;
    }
    const entry: OnceScheduleJobIndexEntry = {
      ...base, scheduleType: 'once', runAt: this.config.schedule.runAt,
    };
    return entry;
  }

  public assign(file: ScheduleJobFile): ScheduleJob {
    this.config.assign(file);
    return this;
  }

  /**
   * jobs.json 索引是 runState 的 source of truth；本方法把索引里那一行 merge 回 job 实例。
   * 由 Agent.getJob 在 load 完 job.json 后调用，避免外部直接 set `job.config.runState`。
   */
  public mergeRunStateFromIndex(runState: JobRunState): void {
    this.config.runState = runState;
  }

  /**
   * 写 job.json + 触发 onChange 同步 jobs.json。由 PersistBase 节流。
   * updatedAt 由 mutate 路径自行决定（例如 startRun 想保留 input.startedAt，就不刷）。
   */
  protected async doPersist(): Promise<void> {
    await writeJson(
      PERSIST_PATH.jobFile(getAppRoot(), this.profileId, this.agentId, this.id),
      this.config.toFile(this.id, this.agentId),
    );
    await this.onChange?.();
  }

  /** @internal 仅供 Agent.deleteJob 调用。 */
  public async deleteFromDisk(): Promise<void> {
    await removeDirIfExists(PERSIST_PATH.jobDir(getAppRoot(), this.profileId, this.agentId, this.id));
  }

  // -------------------------------------------------------------------------
  // runs —— 调度执行的 session 化形态
  // -------------------------------------------------------------------------

  /** 启动一次新执行 —— 创建一个挂在 jobs/{j}/runs/{ym}/{s}/ 下的 session。 */
  public async startRun(input: { startedAt: string }): Promise<JobRun> {
    const sessionId = newEntityId('s');
    const session = new JobRun(this.profileId, this.agentId, sessionId, this.id, this.jobRunIdx);
    session.init({
      // 月份由 startedAt 决定 —— id 不再隐含时间
      month: MONTH_KEY(new Date(input.startedAt)),
      startedAt: input.startedAt,
    });
    // session.persist() 内 afterPersist → jobRunIdx.upsert + emit schedule:run:updated。
    await session.persist();
    this.runs.set(sessionId, session);

    this.config.runState = { status: 'running', startedAt: input.startedAt };
    await this.persist();
    return session;
  }

  /**
   * 取一次 run session。先查内存缓存；未命中 → 查 `job_runs` 表拿 month → JobRun.load。
   * 老 fan-out listDirs 已删，PK 查询 O(log N)。
   */
  public async getRun(id: string): Promise<JobRun | undefined> {
    const cached = this.runs.get(id);
    if (cached) return cached;
    const row = this.jobRunIdx.findById(id);
    if (!row || row.jobId !== this.id) return undefined;
    const session = await JobRun.load(this.profileId, this.agentId, id, row.month, this.id, this.jobRunIdx);
    if (!session) return undefined;
    this.runs.set(id, session);
    return session;
  }

  /** 完成一次运行；result 必须与状态对齐（completed 无 error，failed 必须有 error）。 */
  public async finishRun(
    runId: string,
    result:
      | { status: 'completed'; completedAt: string }
      | { status: 'failed'; completedAt: string; error: string },
  ): Promise<{ runState: JobRunState }> {
    const session = await this.getRun(runId);
    if (!session) throw new Error(`ScheduleJob.finishRun: run not found ${runId}`);
    const meta = await session.finish(result);

    const runState: JobRunState =
      meta.status === 'completed'
        ? { status: 'completed', startedAt: meta.startedAt, finishedAt: meta.completedAt }
        : meta.status === 'failed'
          ? { status: 'failed', startedAt: meta.startedAt, finishedAt: meta.completedAt, error: meta.error }
          : { status: 'running', startedAt: meta.startedAt }; // 不可能走到（finish 已校验）
    this.config.runState = runState;
    this.config.updatedAt = new Date().toISOString();
    await this.persist();
    // run 已结束，从内存缓存里 evict —— 防止长跑 cron job 堆积。
    this.runs.delete(runId);
    return { runState };
  }

  /** 删除一条已结束的 run；执行中的 run 仍可能写入，必须拒绝删除。 */
  public async deleteRun(runId: string): Promise<boolean> {
    const row = this.jobRunIdx.findById(runId);
    if (!row || row.jobId !== this.id) return false;
    if (row.runStatus === 'running') {
      throw new Error('Cannot delete a running schedule run.');
    }

    const runDir = `${PERSIST_PATH.jobRunsDir(getAppRoot(), this.profileId, this.agentId, this.id)}/${row.month}/${runId}`;
    await removeDirIfExists(runDir);
    this.jobRunIdx.remove(runId);
    this.runs.delete(runId);
    emit('schedule:run:removed', {
      profileId: this.profileId,
      agentId: this.agentId,
      jobId: this.id,
      sessionId: runId,
    });
    return true;
  }

  /**
   * 列出该 job 的所有 run（按 started_at 倒序）。SQL 直查 `job_runs` 表，索引 `ix_runs_job_started`
   * 命中；调用方按 `r.runStatus` / `r.runError` 字段判定状态机。
   * 方法名保留 `listRunsOnDisk` 是与历史调用方兼容（虽然底层不再扫盘）。
   */
  public async listRunsOnDisk(): Promise<JobRunRow[]> {
    return this.jobRunIdx.listJobRuns(this.id);
  }
}

// ---------------------------------------------------------------------------
// ScheduleRegistry —— 单 agent 内 jobs.json 索引 + per-job 目录管理
//
// API 风格：与 SessionRegistry 对齐 —— upsert / remove 是纯内存改动，调用方负责 await persist()。
// persist 由 PersistBase 节流：连续 upsert + persist 会合并成单次写盘。

export class ScheduleRegistry extends PersistBase {
  public items: ScheduleJobIndexEntry[] = [];

  constructor(
    public readonly profileId: string,
    public readonly agentId: string,
  ) {
    super();
  }

  private file(): string {
    return PERSIST_PATH.jobsIndexFile(getAppRoot(), this.profileId, this.agentId);
  }

  public async load(): Promise<void> {
    const f = await readJsonOrNull<ScheduleJobsIndexFile>(this.file());
    this.items = f?.items ?? [];
  }

  protected async doPersist(): Promise<void> {
    const file: ScheduleJobsIndexFile = { version: SCHEDULE_JOBS_INDEX_VERSION, items: this.items };
    await writeJson(this.file(), file);
  }

  public get(id: string): ScheduleJobIndexEntry | undefined {
    return this.items.find((e) => e.id === id);
  }

  public upsert(entry: ScheduleJobIndexEntry): Promise<void> {
    const idx = this.items.findIndex((e) => e.id === entry.id);
    if (idx >= 0) this.items[idx] = entry;
    else this.items.push(entry);
    return this.persist();
  }

  public remove(id: string): Promise<void> {
    this.items = this.items.filter((e) => e.id !== id);
    return this.persist();
  }
}
