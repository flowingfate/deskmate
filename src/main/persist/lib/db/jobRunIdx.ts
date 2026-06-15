/**
 * `job_runs` 表的同步读写入口。
 *
 * 设计稿：[ai.prompt/persist.md §9.1](../../../../../ai.prompt/persist.md)（job_runs 表）。
 *
 * 不变量：
 *  - DB 行是派生缓存，源真值是各 schedule_run `data.json`。任何 mutate 都被 `rebuildFromDisk()` 覆盖。
 *  - 不 emit `session:index:updated`（schedule_run 不进入该 atom）；状态变化广播由 `JobRun.afterPersist`
 *    在 upsert 之后单独触发 `schedule:run:updated`，与本类解耦。
 *  - `job_id` 不与 `schedule_jobs` 表做 FK：jobs 不进 DB；孤儿 run 行由 rebuild 时按 `jobs.json`
 *    items 过滤清除。
 *  - 不持有 `ProfileDb` 引用，而是每次按 profileId lookup —— 让 Profile.load 的"DB 损坏 → 重建"
 *    路径替换 cache 后旧引用不会悬空。
 */
import type { Database } from 'better-sqlite3';

import type { JobRunRow, ScheduleRunSessionDataFile } from '../../../../shared/persist/types';
import { PERSIST_PATH } from '../../../../shared/persist/path';
import { getAppRoot } from '../root';
import { listDirs, readJsonOrNull } from '../atomic';
import { ProfileDb } from './db';

interface RawRow {
  id: string;
  agent_id: string;
  job_id: string;
  month: string;
  title: string;
  read_status: 'read' | 'unread';
  run_status: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at: string | null;
  run_error: string | null;
  created_at: string;
  updated_at: string;
}

function fromRaw(r: RawRow): JobRunRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    jobId: r.job_id,
    month: r.month,
    title: r.title,
    readStatus: r.read_status,
    runStatus: r.run_status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    runError: r.run_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class JobRunIdx {
  constructor(public readonly profileId: string) {}

  /** 每次 SQL 前 lookup 最新 `ProfileDb`，避免 DB 重建后悬空引用。 */
  private get db(): Database {
    return ProfileDb.open(this.profileId).db;
  }

  public upsert(row: JobRunRow): void {
    this.db.prepare(`
      INSERT INTO job_runs(id, agent_id, job_id, month, title, read_status,
                           run_status, started_at, finished_at, run_error,
                           created_at, updated_at)
      VALUES (@id, @agentId, @jobId, @month, @title, @readStatus,
              @runStatus, @startedAt, @finishedAt, @runError,
              @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        agent_id     = excluded.agent_id,
        job_id       = excluded.job_id,
        month        = excluded.month,
        title        = excluded.title,
        read_status  = excluded.read_status,
        run_status   = excluded.run_status,
        started_at   = excluded.started_at,
        finished_at  = excluded.finished_at,
        run_error    = excluded.run_error,
        created_at   = excluded.created_at,
        updated_at   = excluded.updated_at
    `).run(row);
  }

  public remove(id: string): void {
    this.db.prepare('DELETE FROM job_runs WHERE id = ?').run(id);
  }

  public findById(id: string): JobRunRow | undefined {
    const raw = this.db
      .prepare('SELECT * FROM job_runs WHERE id = ?')
      .get(id) as RawRow | undefined;
    return raw ? fromRaw(raw) : undefined;
  }

  /**
   * 单 job 历史 runs（最近优先）。索引 `ix_runs_job_started` 命中。
   * 用于 `ScheduleJob.listRunsOnDisk` 老 API（保留方法名，底层切 SQL）。
   */
  public listJobRuns(jobId: string): JobRunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM job_runs WHERE job_id = ? ORDER BY started_at DESC')
      .all(jobId) as RawRow[];
    return rows.map(fromRaw);
  }

  /**
   * 跨 job 聚合单 agent 全部 schedule_run（最近优先）。索引 `ix_runs_agent_started` 命中。
   * `Agent.listAllScheduleRuns` 用：原 fan-out readJson 已退化为单条 SQL。
   */
  public listAgentRuns(agentId: string): JobRunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM job_runs WHERE agent_id = ? ORDER BY started_at DESC')
      .all(agentId) as RawRow[];
    return rows.map(fromRaw);
  }

  /**
   * 未读窗口扫描（`Agent.getUnreadSummary` schedule_run 段）。
   * sinceIso 默认 `'0'` 等价"无下界"（ISO 8601 字符串字典序）。
   * 偏序索引 `ix_runs_agent_unread` 命中。
   */
  public countUnread(agentId: string, sinceIso?: string): number {
    const since = sinceIso ?? '0';
    const row = this.db
      .prepare(`SELECT count(*) AS n FROM job_runs
                WHERE agent_id = ? AND read_status = 'unread' AND started_at >= ?`)
      .get(agentId, since) as { n: number };
    return row.n;
  }

  /** 删 job 时连带清掉它的 runs。返回受影响行数（仅供日志/测试断言）。 */
  public removeByJob(jobId: string): number {
    const info = this.db.prepare('DELETE FROM job_runs WHERE job_id = ?').run(jobId);
    return Number(info.changes);
  }

  /**
   * 灾难恢复：扫盘所有 `agents/*\/schedules/*\/runs/{YYYYMM}/*` 重建表。
   * 单事务包裹。仅 schedule_run；regular 走 `SessionIdx.rebuildFromDisk()`。
   */
  public async rebuildFromDisk(): Promise<{ inserted: number; warnings: string[] }> {
    const warnings: string[] = [];
    const root = getAppRoot();
    const agentsRoot = PERSIST_PATH.agentsDir(root, this.profileId);
    const agentIds = await listDirs(agentsRoot);
    const collected: JobRunRow[] = [];
    for (const agentId of agentIds) {
      const schedulesRoot = PERSIST_PATH.schedulesDir(root, this.profileId, agentId);
      const jobIds = await listDirs(schedulesRoot);
      for (const jobId of jobIds) {
        const runsRoot = PERSIST_PATH.jobRunsDir(root, this.profileId, agentId, jobId);
        const months = await listDirs(runsRoot);
        for (const month of months) {
          const runIds = await listDirs(`${runsRoot}/${month}`);
          for (const runId of runIds) {
            const data = await readJsonOrNull<ScheduleRunSessionDataFile>(`${runsRoot}/${month}/${runId}/data.json`);
            if (!data || data.kind !== 'schedule_run') continue;
            const meta = data.scheduleRun;
            const finishedAt = meta.status === 'running' ? null : meta.completedAt;
            const runError = meta.status === 'failed' ? meta.error : null;
            collected.push({
              id: data.id,
              agentId,
              jobId,
              month,
              title: data.title,
              readStatus: data.readStatus,
              runStatus: meta.status,
              startedAt: meta.startedAt,
              finishedAt,
              runError,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
            });
          }
        }
      }
    }
    const tx = this.db.transaction((rows: JobRunRow[]) => {
      this.db.prepare('DELETE FROM job_runs').run();
      const stmt = this.db.prepare(`
        INSERT INTO job_runs(id, agent_id, job_id, month, title, read_status,
                             run_status, started_at, finished_at, run_error,
                             created_at, updated_at)
        VALUES (@id, @agentId, @jobId, @month, @title, @readStatus,
                @runStatus, @startedAt, @finishedAt, @runError,
                @createdAt, @updatedAt)
      `);
      for (const row of rows) stmt.run(row);
    });
    tx(collected);
    return { inserted: collected.length, warnings };
  }
}
