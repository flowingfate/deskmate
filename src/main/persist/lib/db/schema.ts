/**
 * `profiles/{p_id}/index.db` 的 schema 单一 source of truth。
 *
 * 设计要点见 [ai.prompt/persist.md §9](../../../../ai.prompt/persist.md)：
 *  - `regular_sessions` 与 `job_runs` 物理分表（不同字段集、不同偏序索引）。
 *  - 时间列强制 ISO UTC `...Z` 结尾（`CHECK col LIKE '%Z'`）—— 字符串字典序与时间序等价。
 *  - 偏序索引收紧 `WHERE read_status='unread'` / `WHERE starred_at IS NOT NULL`：未读 / 收藏的 hot
 *    路径用 COUNT/SELECT 直接命中索引，跳过全表。
 *  - 不建跨 profile 表 —— 隔离不变量见 ai.prompt/persist.md §2；每 profile 一个 DB。
 *
 * 改 schema 时同步更新：
 *  - `RegularSessionRow` / `JobRunRow` 类型（`shared/persist/types.ts`）
 *  - `_meta.schema_version`（migrate 路径触发条件）
 */

/** 当前 schema 版本号；写入 `_meta.schema_version`。 */
export const PERSIST_DB_SCHEMA_VERSION = 1;

export const PERSIST_DB_DDL = `
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regular_sessions (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  month        TEXT NOT NULL,
  title        TEXT NOT NULL,
  read_status  TEXT NOT NULL CHECK (read_status IN ('read','unread')),
  starred_at   TEXT,
  created_at   TEXT NOT NULL CHECK (created_at LIKE '%Z'),
  updated_at   TEXT NOT NULL CHECK (updated_at LIKE '%Z')
);

CREATE INDEX IF NOT EXISTS ix_regular_agent_updated
  ON regular_sessions(agent_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS ix_regular_agent_created
  ON regular_sessions(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_regular_agent_unread
  ON regular_sessions(agent_id)
  WHERE read_status = 'unread';

CREATE INDEX IF NOT EXISTS ix_regular_agent_starred
  ON regular_sessions(agent_id, starred_at DESC)
  WHERE starred_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_runs (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  job_id       TEXT NOT NULL,
  month        TEXT NOT NULL,
  title        TEXT NOT NULL,
  read_status  TEXT NOT NULL CHECK (read_status IN ('read','unread')),

  run_status   TEXT NOT NULL CHECK (run_status IN ('running','completed','failed')),
  started_at   TEXT NOT NULL CHECK (started_at LIKE '%Z'),
  finished_at  TEXT CHECK (finished_at IS NULL OR finished_at LIKE '%Z'),
  run_error    TEXT,

  created_at   TEXT NOT NULL CHECK (created_at LIKE '%Z'),
  updated_at   TEXT NOT NULL CHECK (updated_at LIKE '%Z'),

  CHECK (
    (run_status = 'running'   AND finished_at IS NULL     AND run_error IS NULL) OR
    (run_status = 'completed' AND finished_at IS NOT NULL AND run_error IS NULL) OR
    (run_status = 'failed'    AND finished_at IS NOT NULL AND run_error IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_runs_job_started
  ON job_runs(job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_runs_agent_started
  ON job_runs(agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_runs_agent_created
  ON job_runs(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_runs_agent_unread
  ON job_runs(agent_id, started_at)
  WHERE read_status = 'unread';
`;
