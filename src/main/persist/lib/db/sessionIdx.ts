/**
 * `regular_sessions` 表的同步读写入口。
 *
 * 设计稿：[ai.prompt/persist.md §9.1](../../../../../ai.prompt/persist.md)（regular_sessions 表）。
 *
 * 不变量：
 *  - DB 行是派生缓存，源真值是各 `data.json`。任何 mutate 都被 `rebuildFromDisk()` 覆盖。
 *  - 写路径每次都 emit `session:index:updated`（单条 op 粒度，避免老模型的"整月数组重发"）。
 *  - starred：`Session.setStar(star)` 写 data.json → onChange → 本类 `upsert`（不刷 updated_at，
 *    与 `setReadStatus` 同语义）。`starred:updated` 由 `setSessionStarred` IPC handler 显式补一次。
 *  - 不持 PersistBase 节流：SQLite UPSERT 已是 O(log N) + WAL，节流反而引入"窗口内多次 mutate 只
 *    发一次事件"的语义偏差，不必要。
 *  - 同步 API：better-sqlite3 同步，没必要包 Promise 增加调度噪音。`Session.persist` 仍是 async
 *    （文件 IO），但内嵌的 DB 写是 sync step。
 *  - 不持有 `ProfileDb` 引用，而是每次按 profileId lookup —— 让 Profile.load 的"DB 损坏 → 重建"
 *    路径替换 cache 后旧引用不会悬空。
 */
import type { Database } from 'better-sqlite3';

import type { RegularSessionDataFile, RegularSessionIndexEntry, RegularSessionRow, StarredSessionEntry } from '../../../../shared/persist/types';
import { PERSIST_PATH } from '../../../../shared/persist/path';
import { getAppRoot } from '../root';
import { listDirs, readJsonOrNull } from '../atomic';
import { emit } from '../emit';
import { ProfileDb } from './db';

interface RawRow {
  id: string;
  agent_id: string;
  month: string;
  title: string;
  read_status: 'read' | 'unread';
  starred_at: string | null;
  created_at: string;
  updated_at: string;
}

function fromRaw(r: RawRow): RegularSessionRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    month: r.month,
    title: r.title,
    readStatus: r.read_status,
    starredAt: r.starred_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toEntry(row: RegularSessionRow): RegularSessionIndexEntry {
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
}

export class SessionIdx {
  constructor(public readonly profileId: string) {}

  /** 每次 SQL 前 lookup 最新 `ProfileDb`，避免 DB 重建后悬空引用。 */
  private get db(): Database {
    return ProfileDb.open(this.profileId).db;
  }

  /**
   * UPSERT 单行。emit `session:index:updated`(op='upsert')。
   * upsert 是常规 hot path（每条 mutate 都跑）；prepare statement 缓存让单次 < 1ms。
   */
  public upsert(row: RegularSessionRow): void {
    this.db.prepare(`
      INSERT INTO regular_sessions(id, agent_id, month, title, read_status, starred_at, created_at, updated_at)
      VALUES (@id, @agentId, @month, @title, @readStatus, @starredAt, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        agent_id    = excluded.agent_id,
        month       = excluded.month,
        title       = excluded.title,
        read_status = excluded.read_status,
        starred_at  = excluded.starred_at,
        created_at  = excluded.created_at,
        updated_at  = excluded.updated_at
    `).run(row);
    emit(this.profileId, 'session:index:updated', {
      agentId: row.agentId,
      op: 'upsert',
      entry: toEntry(row),
    });
  }

  /**
   * DELETE 单行。行不存在 → no-op + 不 emit；行存在 → DELETE + emit op='remove'。
   * 不查 `findById` 然后 DELETE：用 RETURNING 一次 round-trip 拿走 agent_id。
   */
  public remove(id: string): void {
    const row = this.db
      .prepare('DELETE FROM regular_sessions WHERE id = ? RETURNING agent_id AS agentId')
      .get(id) as { agentId: string } | undefined;
    if (!row) return;
    emit(this.profileId, 'session:index:updated', {
      agentId: row.agentId,
      op: 'remove',
      id,
    });
  }


  /**
   * 列出某 agent 全部 regular session（按 updated_at 倒序）。renderer atom 一次性 hydrate 用。
   * N 通常 < 数千；不分页。
   */
  public listAgent(agentId: string): RegularSessionRow[] {
    const rows = this.db
      .prepare('SELECT * FROM regular_sessions WHERE agent_id = ? ORDER BY updated_at DESC')
      .all(agentId) as RawRow[];
    return rows.map(fromRaw);
  }

  public findById(id: string): RegularSessionRow | undefined {
    const raw = this.db
      .prepare('SELECT * FROM regular_sessions WHERE id = ?')
      .get(id) as RawRow | undefined;
    return raw ? fromRaw(raw) : undefined;
  }

  /** 偏序索引 `ix_regular_agent_unread` 命中：跳过 read='read' 行。 */
  public countUnread(agentId: string): number {
    const row = this.db
      .prepare(`SELECT count(*) AS n FROM regular_sessions WHERE agent_id = ? AND read_status = 'unread'`)
      .get(agentId) as { n: number };
    return row.n;
  }

  /** 该 profile 全部 regular session 行数（全表 COUNT，用于存储概览）。 */
  public countAll(): number {
    const row = this.db.prepare('SELECT count(*) AS n FROM regular_sessions').get() as { n: number };
    return row.n;
  }

  /** 某 agent 的 regular session 行数（`ix_regular_agent_updated` 命中）。 */
  public countAgent(agentId: string): number {
    const row = this.db
      .prepare('SELECT count(*) AS n FROM regular_sessions WHERE agent_id = ?')
      .get(agentId) as { n: number };
    return row.n;
  }

  /**
   * 列出某 agent 已收藏 entry（按 starred_at 倒序）；agentId 省略 → profile 内全部 starred。
   * 偏序索引 `ix_regular_agent_starred` 命中。
   */
  public listStarred(agentId?: string): StarredSessionEntry[] {
    const sql = agentId === undefined
      ? `SELECT id, agent_id, starred_at FROM regular_sessions
         WHERE starred_at IS NOT NULL ORDER BY starred_at DESC`
      : `SELECT id, agent_id, starred_at FROM regular_sessions
         WHERE agent_id = ? AND starred_at IS NOT NULL ORDER BY starred_at DESC`;
    const rows = (agentId === undefined
      ? this.db.prepare(sql).all()
      : this.db.prepare(sql).all(agentId)) as Array<{ id: string; agent_id: string; starred_at: string }>;
    return rows.map((r) => ({ agentId: r.agent_id, sessionId: r.id, starredAt: r.starred_at }));
  }

  /**
   * 灾难恢复：扫盘所有月份目录下的 data.json 重建表。
   * - **覆盖语义**：先 DELETE 全部 → 按盘 INSERT。在内存里但盘上不存在的行（孤儿）一并清。
   * - 仅 regular。schedule_run 走 `JobRunIdx.rebuildFromDisk()`，不交叉。
   * - 单事务包裹：扫盘 N 个 data.json 写入 1 次 commit；中途崩溃 → 整事务回滚 → 旧表
   *   仍可用（但 stale）；下次启动 integrity_check 仍能继续走 rebuild 路径。
   */
  public async rebuildFromDisk(): Promise<{ inserted: number; warnings: string[] }> {
    const warnings: string[] = [];
    const root = getAppRoot();
    const agentsRoot = PERSIST_PATH.agentsDir(root, this.profileId);
    const agentIds = await listDirs(agentsRoot);
    const collected: RegularSessionRow[] = [];
    for (const agentId of agentIds) {
      const sessionsRoot = PERSIST_PATH.sessionsDir(root, this.profileId, agentId);
      const months = await listDirs(sessionsRoot);
      for (const month of months) {
        const sessionIds = await listDirs(`${sessionsRoot}/${month}`);
        for (const sid of sessionIds) {
          const data = await readJsonOrNull<RegularSessionDataFile>(
            PERSIST_PATH.sessionData(root, this.profileId, agentId, month, sid),
          );
          if (!data || data.kind !== 'regular') continue;
          collected.push({
            id: data.id,
            agentId,
            month,
            title: data.title,
            readStatus: data.readStatus,
            starredAt: data.star?.starredAt ?? null,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          });
        }
      }
    }
    const tx = this.db.transaction((rows: RegularSessionRow[]) => {
      this.db.prepare('DELETE FROM regular_sessions').run();
      const stmt = this.db.prepare(`
        INSERT INTO regular_sessions(id, agent_id, month, title, read_status, starred_at, created_at, updated_at)
        VALUES (@id, @agentId, @month, @title, @readStatus, @starredAt, @createdAt, @updatedAt)
      `);
      for (const row of rows) stmt.run(row);
    });
    tx(collected);
    return { inserted: collected.length, warnings };
  }
}
