// Pino worker transport — 写入 SQLite。
// 必须为 CJS（pino worker 用 require 加载），且自包含（不引用 TS 源码）。
// Schema 是单份 source of truth：DDL 仅在此文件内联。改 schema 时同步更新
// src/shared/log/types.ts (LogRow) 与 src/shared/log/query/schema.ts (LOG_SCHEMA_DOC)。

'use strict';

const build = require('pino-abstract-transport');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DDL = `
CREATE TABLE IF NOT EXISTS app_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  level        INTEGER NOT NULL,
  process_type TEXT NOT NULL,
  pid          INTEGER NOT NULL,
  component    TEXT NOT NULL,
  msg          TEXT NOT NULL,
  trace_id     TEXT,
  span_id      TEXT,
  parent_span_id TEXT,
  err_message  TEXT,
  err_stack    TEXT,
  window_id    INTEGER,
  life_id      INTEGER NOT NULL,
  fields       TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_ts        ON app_logs(ts);
CREATE INDEX IF NOT EXISTS idx_logs_level_ts  ON app_logs(level, ts);
CREATE INDEX IF NOT EXISTS idx_logs_comp_ts   ON app_logs(component, ts);
CREATE INDEX IF NOT EXISTS idx_logs_trace
  ON app_logs(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_life      ON app_logs(life_id);
CREATE VIRTUAL TABLE IF NOT EXISTS app_logs_fts USING fts5(
  msg, err_stack, fields,
  content='app_logs', content_rowid='id',
  tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS app_logs_ai AFTER INSERT ON app_logs BEGIN
  INSERT INTO app_logs_fts(rowid, msg, err_stack, fields)
  VALUES (new.id, new.msg, coalesce(new.err_stack,''), coalesce(new.fields,''));
END;
CREATE TRIGGER IF NOT EXISTS app_logs_ad AFTER DELETE ON app_logs BEGIN
  INSERT INTO app_logs_fts(app_logs_fts, rowid, msg, err_stack, fields)
  VALUES('delete', old.id, old.msg, coalesce(old.err_stack,''), coalesce(old.fields,''));
END;
CREATE TRIGGER IF NOT EXISTS app_logs_au AFTER UPDATE ON app_logs BEGIN
  INSERT INTO app_logs_fts(app_logs_fts, rowid, msg, err_stack, fields)
  VALUES('delete', old.id, old.msg, coalesce(old.err_stack,''), coalesce(old.fields,''));
  INSERT INTO app_logs_fts(rowid, msg, err_stack, fields)
  VALUES (new.id, new.msg, coalesce(new.err_stack,''), coalesce(new.fields,''));
END;
`;

const INSERT_SQL =
  'INSERT INTO app_logs (ts, level, process_type, pid, component, msg, trace_id, span_id, parent_span_id, err_message, err_stack, window_id, life_id, fields) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

// pino 顶层保留字，不应进 fields 列。
// 注意：业务 API 用短键（mod/tid/sid/psid/dur），列名仍是 component/trace_id/span_id/parent_span_id —— 这里做映射。
const RESERVED = new Set([
  'time',
  'level',
  'msg',
  'pid',
  'hostname',
  'mod',
  'processType',
  'tid',
  'sid',
  'psid',
  'dur',
  'err',
  'windowId',
  'v',
]);

function extractFields(obj) {
  const out = {};
  let has = false;
  for (const k of Object.keys(obj)) {
    if (RESERVED.has(k)) continue;
    out[k] = obj[k];
    has = true;
  }
  // dur 业务上虽不属 trace 列，但值得保留在 fields 里供查询。
  if (typeof obj.dur === 'number') {
    out.dur = obj.dur;
    has = true;
  }
  return has ? JSON.stringify(out) : null;
}

module.exports = function (opts) {
  const dbPath = opts && opts.dbPath;
  if (!dbPath) throw new Error('sqlite-transport: opts.dbPath required');
  const maxRows = (opts && opts.maxRows) || 200_000;
  const rotateEvery = (opts && opts.rotateEvery) || 1000;
  const lifeId = opts.lifeId;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.exec(DDL);

  const insert = db.prepare(INSERT_SQL);
  // max(id) - min(id) + 1 走 rowid 索引 O(log N)，比 COUNT(*) 全表扫便宜得多。
  // 误差仅来自 AUTOINCREMENT 不复用 id：当 rotate 删了头部 N 行，估值与真实行数完全一致；
  // 因此可放心当作精确行数使用。
  const countStmt = db.prepare(
    'SELECT COALESCE(max(id) - min(id) + 1, 0) AS n FROM app_logs'
  );
  // 范围 DELETE 替代子查询 IN：避免 sqlite 为子查询构造 20k id 临时表。
  // FTS 触发器仍逐行跑（无法绕开），但 SQL 层省了一次扫描。
  const deleteStmt = db.prepare(
    'DELETE FROM app_logs WHERE id < (SELECT min(id) FROM app_logs) + ?'
  );
  let count = 0;

  function rotate() {
    const row = countStmt.get();
    if (row.n <= maxRows) return;
    const drop = Math.ceil(maxRows * 0.1);
    deleteStmt.run(drop);
  }

  return build(
    async function (source) {
      for await (const obj of source) {
        try {
          const ts = typeof obj.time === 'number' ? obj.time : Date.now();
          const level = typeof obj.level === 'number' ? obj.level : 30;
          const processType = obj.processType || 'main';
          const pid = typeof obj.pid === 'number' ? obj.pid : process.pid;
          const component = obj.mod || 'unknown';
          const msg = obj.msg || '';
          const traceId = obj.tid || null;
          const spanId = obj.sid || null;
          const parentSpanId = obj.psid || null;
          const errMessage = obj.err && obj.err.message ? obj.err.message : null;
          const errStack = obj.err && obj.err.stack ? obj.err.stack : null;
          const windowId =
            typeof obj.windowId === 'number' ? obj.windowId : null;
          const fields = extractFields(obj);

          insert.run(
            ts,
            level,
            processType,
            pid,
            component,
            msg,
            traceId,
            spanId,
            parentSpanId,
            errMessage,
            errStack,
            windowId,
            lifeId,
            fields
          );

          if (++count % rotateEvery === 0) rotate();
        } catch (e) {
          // Worker 内出错不能 throw（会导致整条流终止），直接 stderr。
          console.error('[sqlite-transport] insert failed:', e);
        }
      }
    },
    {
      async close() {
        try {
          db.close();
        } catch {
          // ignore
        }
      },
    }
  );
};
