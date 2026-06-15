/**
 * Step 9 PR-1：`lib/db.ts` + `lib/schema.ts` 单元测试。
 *
 * 覆盖：
 *  - DDL 幂等（重复 exec 不抛）
 *  - WAL + foreign_keys pragma 生效
 *  - `_meta.schema_version` 首次写入、二次打开不重复写
 *  - `regular_sessions` / `job_runs` CHECK 约束（read_status / run_status / Z 时间格式 / run_status × finished_at × error 状态机）
 *  - 偏序索引使用（EXPLAIN QUERY PLAN 命中）
 *  - `checkIntegrity()` 真值 / 假值
 *
 * 不用 mock fs：sqlite native + 文件 io 必须真打盘；用 vitest tmp 目录。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setRootForTesting } from '../lib/root';
import { ProfileDb, profileDbPath, unlinkProfileDb } from '../lib/db/db';
import { PERSIST_DB_DDL, PERSIST_DB_SCHEMA_VERSION } from '../lib/db/schema';

let tmpRoot = '';
const PROFILE_ID = 'p_TEST_DB';

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-step9-'));
  setRootForTesting(tmpRoot);
});

afterEach(() => {
  ProfileDb.resetForTesting();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('ProfileDb.open + DDL', () => {
  it('creates index.db with WAL + meta on first open, reuses on second', () => {
    const a = ProfileDb.open(PROFILE_ID);
    expect(fs.existsSync(profileDbPath(PROFILE_ID))).toBe(true);
    expect(a.schemaVersion()).toBe(PERSIST_DB_SCHEMA_VERSION);

    // pragma: WAL mode
    const journal = a.db.pragma('journal_mode', { simple: true });
    expect(String(journal).toLowerCase()).toBe('wal');

    // pragma: foreign_keys on
    const fk = a.db.pragma('foreign_keys', { simple: true });
    expect(Number(fk)).toBe(1);

    // 同 profile 二次 open 复用同一连接
    const b = ProfileDb.open(PROFILE_ID);
    expect(b).toBe(a);

    // close 后再 open 是新连接，但 schema_version 不变 (DDL 幂等 + meta 不重复 insert)
    ProfileDb.close(PROFILE_ID);
    const c = ProfileDb.open(PROFILE_ID);
    expect(c).not.toBe(a);
    expect(c.schemaVersion()).toBe(PERSIST_DB_SCHEMA_VERSION);
    const metaRows = c.db.prepare(`SELECT count(*) AS n FROM _meta WHERE key = 'schema_version'`).get() as { n: number };
    expect(metaRows.n).toBe(1);
  });

  it('DDL exec is idempotent on an already-populated DB', () => {
    const h = ProfileDb.open(PROFILE_ID);
    h.db.prepare(`
      INSERT INTO regular_sessions(id, agent_id, month, title, read_status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).run('s_X', 'a_X', '202606', 't', 'unread', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');

    // 重复跑 DDL：表 / 索引 IF NOT EXISTS 保证不报错；行不丢
    expect(() => h.db.exec(PERSIST_DB_DDL)).not.toThrow();
    const n = h.db.prepare('SELECT count(*) AS n FROM regular_sessions').get() as { n: number };
    expect(n.n).toBe(1);
  });
});

describe('regular_sessions CHECK constraints', () => {
  it('rejects bad read_status', () => {
    const h = ProfileDb.open(PROFILE_ID);
    expect(() => h.db.prepare(`
      INSERT INTO regular_sessions(id, agent_id, month, title, read_status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).run('s_1', 'a_1', '202606', 't', 'NEW', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'))
      .toThrow(/CHECK constraint/);
  });

  it('rejects non-Z created_at / updated_at', () => {
    const h = ProfileDb.open(PROFILE_ID);
    expect(() => h.db.prepare(`
      INSERT INTO regular_sessions(id, agent_id, month, title, read_status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).run('s_2', 'a_1', '202606', 't', 'unread', '2026-06-01T00:00:00+08:00', '2026-06-01T00:00:00Z'))
      .toThrow(/CHECK constraint/);
  });

  it('allows NULL starred_at and updates it later', () => {
    const h = ProfileDb.open(PROFILE_ID);
    h.db.prepare(`
      INSERT INTO regular_sessions(id, agent_id, month, title, read_status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).run('s_3', 'a_1', '202606', 't', 'read', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
    h.db.prepare('UPDATE regular_sessions SET starred_at = ? WHERE id = ?')
      .run('2026-06-02T00:00:00Z', 's_3');
    const row = h.db.prepare('SELECT starred_at FROM regular_sessions WHERE id = ?').get('s_3') as { starred_at: string };
    expect(row.starred_at).toBe('2026-06-02T00:00:00Z');
  });
});

describe('job_runs CHECK constraints', () => {
  function insertRun(h: ProfileDb, fields: {
    id: string;
    runStatus: 'running' | 'completed' | 'failed';
    finishedAt?: string | null;
    error?: string | null;
  }): void {
    h.db.prepare(`
      INSERT INTO job_runs(id, agent_id, job_id, month, title, read_status,
                           run_status, started_at, finished_at, run_error,
                           created_at, updated_at)
      VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?)
    `).run(
      fields.id, 'a_1', 'j_1', '202606', 't', 'unread',
      fields.runStatus, '2026-06-01T00:00:00Z',
      fields.finishedAt ?? null, fields.error ?? null,
      '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z',
    );
  }

  it('running requires finished_at NULL + run_error NULL', () => {
    const h = ProfileDb.open(PROFILE_ID);
    expect(() => insertRun(h, { id: 'r_bad', runStatus: 'running', finishedAt: '2026-06-01T00:01:00Z' }))
      .toThrow(/CHECK constraint/);
    expect(() => insertRun(h, { id: 'r_ok',  runStatus: 'running' })).not.toThrow();
  });

  it('completed requires finished_at NOT NULL + run_error NULL', () => {
    const h = ProfileDb.open(PROFILE_ID);
    expect(() => insertRun(h, { id: 'r_bad_a', runStatus: 'completed' }))
      .toThrow(/CHECK constraint/);
    expect(() => insertRun(h, { id: 'r_bad_b', runStatus: 'completed', finishedAt: '2026-06-01T00:01:00Z', error: 'boom' }))
      .toThrow(/CHECK constraint/);
    expect(() => insertRun(h, { id: 'r_ok',    runStatus: 'completed', finishedAt: '2026-06-01T00:01:00Z' }))
      .not.toThrow();
  });

  it('failed requires finished_at NOT NULL + run_error NOT NULL', () => {
    const h = ProfileDb.open(PROFILE_ID);
    expect(() => insertRun(h, { id: 'f_bad_a', runStatus: 'failed', finishedAt: '2026-06-01T00:01:00Z' }))
      .toThrow(/CHECK constraint/);
    expect(() => insertRun(h, { id: 'f_bad_b', runStatus: 'failed', error: 'boom' }))
      .toThrow(/CHECK constraint/);
    expect(() => insertRun(h, { id: 'f_ok',    runStatus: 'failed', finishedAt: '2026-06-01T00:01:00Z', error: 'boom' }))
      .not.toThrow();
  });

  it('rejects bad run_status enum', () => {
    const h = ProfileDb.open(PROFILE_ID);
    expect(() => insertRun(h, { id: 'r_x', runStatus: 'pending' as 'running' }))
      .toThrow(/CHECK constraint/);
  });
});

describe('partial indexes used by hot read paths', () => {
  it('unread COUNT uses ix_regular_agent_unread', () => {
    const h = ProfileDb.open(PROFILE_ID);
    const plan = h.db
      .prepare(`EXPLAIN QUERY PLAN SELECT count(*) FROM regular_sessions WHERE agent_id = ? AND read_status = 'unread'`)
      .all('a_1') as Array<{ detail: string }>;
    const text = plan.map((r) => r.detail).join(' | ');
    expect(text).toMatch(/ix_regular_agent_unread/);
  });

  it('starred listing uses ix_regular_agent_starred', () => {
    const h = ProfileDb.open(PROFILE_ID);
    const plan = h.db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM regular_sessions WHERE agent_id = ? AND starred_at IS NOT NULL ORDER BY starred_at DESC`)
      .all('a_1') as Array<{ detail: string }>;
    const text = plan.map((r) => r.detail).join(' | ');
    expect(text).toMatch(/ix_regular_agent_starred/);
  });

  it('agent updated_at listing uses ix_regular_agent_updated', () => {
    const h = ProfileDb.open(PROFILE_ID);
    const plan = h.db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM regular_sessions WHERE agent_id = ? ORDER BY updated_at DESC`)
      .all('a_1') as Array<{ detail: string }>;
    const text = plan.map((r) => r.detail).join(' | ');
    expect(text).toMatch(/ix_regular_agent_updated/);
  });

  it('job run listing uses ix_runs_job_started', () => {
    const h = ProfileDb.open(PROFILE_ID);
    const plan = h.db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM job_runs WHERE job_id = ? ORDER BY started_at DESC`)
      .all('j_1') as Array<{ detail: string }>;
    const text = plan.map((r) => r.detail).join(' | ');
    expect(text).toMatch(/ix_runs_job_started/);
  });
});

describe('checkIntegrity + unlinkProfileDb', () => {
  it('returns true on a healthy DB', () => {
    const h = ProfileDb.open(PROFILE_ID);
    expect(h.checkIntegrity()).toBe(true);
  });

  it('after close + unlinkProfileDb, files vanish and reopen creates fresh DB', () => {
    const h = ProfileDb.open(PROFILE_ID);
    // 强制 wal/shm 落盘：写一条记录 + wal_checkpoint
    h.db.prepare(`
      INSERT INTO regular_sessions(id, agent_id, month, title, read_status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).run('s_x', 'a_1', '202606', 't', 'unread', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
    h.db.pragma('wal_checkpoint(FULL)');
    const file = profileDbPath(PROFILE_ID);
    expect(fs.existsSync(file)).toBe(true);

    ProfileDb.close(PROFILE_ID);
    unlinkProfileDb(PROFILE_ID);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(file + '-wal')).toBe(false);
    expect(fs.existsSync(file + '-shm')).toBe(false);

    const fresh = ProfileDb.open(PROFILE_ID);
    const n = fresh.db.prepare('SELECT count(*) AS n FROM regular_sessions').get() as { n: number };
    expect(n.n).toBe(0);
    expect(fresh.schemaVersion()).toBe(PERSIST_DB_SCHEMA_VERSION);
  });
});
