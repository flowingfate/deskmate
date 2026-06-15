#!/usr/bin/env bun
/**
 * scripts/log.ts — Deskmate 日志查询 CLI（开发/调试用）。
 *
 * 子命令：
 *   query        通用过滤
 *   trace <id>   按 traceId 拉一次链路时间线
 *   top-errors   错误聚合 Top-N
 *   tail         实时跟随新日志
 *   schema       输出 sqlite 表结构 + 字段语义（喂给 LLM）
 *   sql <stmt>   直接 SELECT 透传（只读连接）
 *   stats        条数 / 按 level/component 分组 / 磁盘占用
 *
 * 默认 JSON 输出；--format text|json|markdown 切换。
 *
 * DB 路径优先级：env DESKMATE_LOG_DB > ~/.deskmate/logs/dev.db（dev）/ app.db（prod）。
 *
 * 实现委托给 src/shared/log/query/，本文件只做 argv 解析 + sqlite 执行 + IO。
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { Database } from 'bun:sqlite';
import { USER_DATA_DIRNAME } from '../src/shared/constants/userDataDir';
import {
  buildQuery,
  buildWhere,
  parseSince,
  parseUntil,
  formatJson,
  formatText,
  formatMarkdown,
  LOG_SCHEMA_DOC,
  LEVEL_NUM,
  NUM_LEVEL,
  type LogLevel,
  type LogQueryFilter,
  type LogRow,
} from '../src/shared/log/query';

// ──────────────────────────────────────────────────────────────────────
// argv 与 DB 打开
// ──────────────────────────────────────────────────────────────────────

const HELP = `Usage: bun scripts/log.ts <subcommand> [options]

Subcommands:
  query [opts]            Filter logs (returns rows)
  trace <traceId>         Show a single trace chronologically
  top-errors [opts]       Aggregate errors by (component, message); default minLevel=error
  tail [opts]             Follow new rows (poll every 250ms); honors all filter flags
  schema                  Print table layout & field semantics
  sql "<SELECT ...>"      Run a raw SELECT (read-only connection)
  stats [opts]            Counts by level / top components / disk size

Filter options (honored by query / top-errors / tail / stats):
  --since <expr>          e.g. "10m", "2h", "@2026-05-29T10:00:00"
  --until <expr>          same grammar as --since
  --level <expr>          set semantics by default: "warn,error" → IN (warn, error)
                          OR minimum-level with "+" suffix: "warn+" → warn or higher
                          single name "warn" → exactly warn
  --component <glob>      e.g. "chat.*", "*Manager"  (% / _ in input are auto-escaped)
  --trace <id>            filter by traceId
  --grep <fts>            SQLite FTS5 MATCH expression against msg+err_stack+fields.
                          ":" and "-" are operators — wrap raw terms in double quotes,
                          e.g. --grep '"timeout: mcp"'.
  --limit <n>             query default 500; top-errors default 20; tail ignored
  --format json|text|markdown   default json (trace defaults to text)

DB path:
  DESKMATE_LOG_DB env wins, else ~/${USER_DATA_DIRNAME}/logs/{dev,app}.db
  (dev when NODE_ENV != "production")
`;

interface Parsed {
  sub: string;
  positional: string[];
  flags: Record<string, string | undefined>;
}

function parseArgv(): Parsed {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const sub = raw[0];
  if (sub === '-h' || sub === '--help' || sub === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  }

  // node:util parseArgs 不支持子命令；自己手动喂剩余 argv
  const { values, positionals } = parseArgs({
    args: raw.slice(1),
    allowPositionals: true,
    strict: false,
    options: {
      since: { type: 'string' },
      until: { type: 'string' },
      level: { type: 'string' },
      component: { type: 'string' },
      trace: { type: 'string' },
      grep: { type: 'string' },
      limit: { type: 'string' },
      format: { type: 'string' },
      follow: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  return {
    sub,
    positional: positionals,
    flags: values as Record<string, string | undefined>,
  };
}

function resolveDbPath(): string {
  if (process.env.DESKMATE_LOG_DB) return process.env.DESKMATE_LOG_DB;
  const fname = process.env.NODE_ENV === 'production' ? 'app.db' : 'dev.db';
  // 依赖 src/main/bootstrap.ts 把 Electron userData 覆写到 $HOME/{USER_DATA_DIRNAME}。
  // CLI 跑在 bun 进程里没有 app.getPath，必须沿用同一常量手动拼。
  return path.join(os.homedir(), USER_DATA_DIRNAME, 'logs', fname);
}

function openDb(): Database {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(
      `log db not found: ${dbPath}\n` +
        `(start the app once so the worker creates the file, or set DESKMATE_LOG_DB)\n`,
    );
    process.exit(2);
  }
  const db = new Database(dbPath, { readonly: true, create: false });
  db.exec('PRAGMA busy_timeout = 1000');
  return db;
}

// ──────────────────────────────────────────────────────────────────────
// flag → LogQueryFilter
// ──────────────────────────────────────────────────────────────────────

// 解析 --level：
//   "warn+" / "warn-or-higher"   -> { minLevel: 'warn' }
//   "warn,error" 或 "warn error" -> { levels: ['warn','error'] }（SQL IN，精确集合）
//   单个名字 "warn"               -> { levels: ['warn'] }（精确）
// 不允许同时给 + 后缀和逗号集合。
function parseLevelFlag(raw: string | undefined): { minLevel?: LogLevel; levels?: LogLevel[] } {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (trimmed.endsWith('+')) {
    const cleaned = trimmed.slice(0, -1).toLowerCase();
    if (!(cleaned in LEVEL_NUM)) {
      throw new Error(`invalid --level: ${raw}. valid: trace|debug|info|warn|error|fatal (+ optional "+")`);
    }
    return { minLevel: cleaned as LogLevel };
  }
  const tokens = trimmed.split(/[,\s]+/).filter(Boolean).map((s) => s.toLowerCase());
  const bad = tokens.filter((t) => !(t in LEVEL_NUM));
  if (bad.length > 0) {
    throw new Error(`invalid level value(s): ${bad.join(', ')}. valid: trace|debug|info|warn|error|fatal`);
  }
  return { levels: tokens as LogLevel[] };
}

function parseLimit(raw: string | undefined, def: number): number {
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --limit: ${raw}`);
  return Math.floor(n);
}

function buildFilterFromFlags(flags: Parsed['flags'], defaultLimit = 500): LogQueryFilter {
  const f: LogQueryFilter = {};
  if (flags.since) f.since = parseSince(flags.since);
  if (flags.until) f.until = parseUntil(flags.until);
  const lvl = parseLevelFlag(flags.level);
  if (lvl.minLevel) f.minLevel = lvl.minLevel;
  if (lvl.levels) f.levels = lvl.levels;
  if (flags.component) f.componentGlob = flags.component;
  if (flags.trace) f.traceId = flags.trace;
  if (flags.grep) f.grep = flags.grep;
  f.limit = parseLimit(flags.limit, defaultLimit);
  return f;
}

type OutputFormat = 'json' | 'text' | 'markdown';
function parseFormat(raw: string | undefined, def: OutputFormat = 'json'): OutputFormat {
  if (!raw) return def;
  if (raw !== 'json' && raw !== 'text' && raw !== 'markdown') {
    throw new Error(`invalid --format: ${raw} (json|text|markdown)`);
  }
  return raw;
}

function renderRows(rows: LogRow[], fmt: OutputFormat): string {
  switch (fmt) {
    case 'json':
      return formatJson(rows, { pretty: true });
    case 'text':
      return formatText(rows);
    case 'markdown':
      return formatMarkdown(rows);
  }
}

// ──────────────────────────────────────────────────────────────────────
// subcommands
// ──────────────────────────────────────────────────────────────────────

async function cmdQuery({ flags }: Parsed): Promise<void> {
  const db = openDb();
  const filter = buildFilterFromFlags(flags);
  const fmt = parseFormat(flags.format);
  const { sql, params } = buildQuery(filter);
  const rows = db.prepare(sql).all(...params) as LogRow[];
  // buildQuery 默认 ORDER BY ts DESC；text/markdown 习惯按时间正序阅读，翻一下
  if (fmt !== 'json') rows.reverse();
  process.stdout.write(renderRows(rows, fmt) + '\n');
}

async function cmdTrace({ positional, flags }: Parsed): Promise<void> {
  const tid = positional[0];
  if (!tid) {
    process.stderr.write('usage: log.ts trace <traceId>\n');
    process.exit(1);
  }
  const db = openDb();
  const rows = db
    .prepare(
      'SELECT id, ts, level, process_type, pid, component, msg, trace_id, span_id, parent_span_id, err_message, err_stack, window_id, life_id, fields ' +
        'FROM app_logs WHERE trace_id = ? ORDER BY ts ASC, id ASC',
    )
    .all(tid) as LogRow[];
  const fmt = parseFormat(flags.format, 'text');
  process.stdout.write(renderRows(rows, fmt) + '\n');
}

async function cmdTopErrors({ flags }: Parsed): Promise<void> {
  const db = openDb();
  const limit = parseLimit(flags.limit, 20);
  // top-errors 默认聚合 error+ 级。如果调用方显式给了 --level，尊重之；否则注入 minLevel='error'。
  const filter = buildFilterFromFlags(flags, limit);
  if (!filter.levels && !filter.minLevel) filter.minLevel = 'error';
  const { where, params } = buildWhere(filter);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      component,
      coalesce(err_message, msg) AS error_key,
      count(*) AS n,
      min(ts) AS first_ts,
      max(ts) AS last_ts
    FROM app_logs
    ${whereSql}
    GROUP BY component, error_key
    ORDER BY n DESC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit) as Array<{
    component: string;
    error_key: string;
    n: number;
    first_ts: number;
    last_ts: number;
  }>;
  const fmt = parseFormat(flags.format);
  if (fmt === 'json') {
    process.stdout.write(
      JSON.stringify(
        rows.map((r) => ({
          component: r.component,
          error: r.error_key,
          count: r.n,
          first: new Date(r.first_ts).toISOString(),
          last: new Date(r.last_ts).toISOString(),
        })),
        null,
        2,
      ) + '\n',
    );
    return;
  }
  // text / markdown 共用人类可读表
  const headers = ['count', 'last', 'component', 'error'];
  if (fmt === 'markdown') {
    process.stdout.write(`| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n`);
    for (const r of rows) {
      const msg = r.error_key.replace(/\|/g, '\\|').slice(0, 200);
      process.stdout.write(
        `| ${r.n} | ${new Date(r.last_ts).toISOString()} | ${r.component} | ${msg} |\n`,
      );
    }
    return;
  }
  for (const r of rows) {
    process.stdout.write(
      `${String(r.n).padStart(5)}  ${new Date(r.last_ts).toISOString()}  ${r.component}\n` +
        `       ${r.error_key.slice(0, 300)}\n`,
    );
  }
}

async function cmdTail({ flags }: Parsed): Promise<void> {
  const db = openDb();
  const fmt = parseFormat(flags.format, 'text');
  const filter = buildFilterFromFlags(flags);
  // 起点 id：从 db 当前最大 id 开始往后看
  let lastId = (db.prepare('SELECT coalesce(max(id), 0) AS m FROM app_logs').get() as { m: number }).m;

  // 把 filter 编成 where；tail 额外加 id > ? 子句（最前）
  const { where, params } = buildWhere(filter);
  const fullWhere = ['id > ?', ...where];
  const sqlText =
    'SELECT id, ts, level, process_type, pid, component, msg, trace_id, span_id, parent_span_id, err_message, err_stack, window_id, life_id, fields ' +
    `FROM app_logs WHERE ${fullWhere.join(' AND ')} ORDER BY id ASC`;
  const stmt = db.prepare(sqlText);

  process.stderr.write(`[tail] starting from id=${lastId} (Ctrl-C to stop)\n`);
  const tick = () => {
    try {
      const rows = stmt.all(lastId, ...params) as LogRow[];
      if (rows.length) {
        lastId = rows[rows.length - 1].id;
        process.stdout.write(renderRows(rows, fmt) + '\n');
      }
    } catch (err) {
      process.stderr.write(`[tail] query failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  };
  setInterval(tick, 250);
  await new Promise(() => {});
}

async function cmdSchema(): Promise<void> {
  process.stdout.write(LOG_SCHEMA_DOC + '\n');
}

async function cmdSql({ positional, flags }: Parsed): Promise<void> {
  const stmtText = positional[0];
  if (!stmtText) {
    process.stderr.write('usage: log.ts sql "<SELECT ...>"\n');
    process.exit(1);
  }
  // 只读连接已保护写操作，但额外做一次显式拒绝以给出更清晰的错误
  if (!/^\s*(select|with)\b/i.test(stmtText)) {
    process.stderr.write('only SELECT / WITH statements are allowed.\n');
    process.exit(1);
  }
  const db = openDb();
  const rows = db.prepare(stmtText).all();
  const fmt = parseFormat(flags.format);
  if (fmt === 'json') {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }
  // text/markdown 直接 JSON 化（任意 SELECT 列形态无法统一表格）
  process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
}

async function cmdStats({ flags }: Parsed): Promise<void> {
  const db = openDb();
  const filter = buildFilterFromFlags(flags);
  const { where, params } = buildWhere(filter);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT count(*) AS n FROM app_logs ${whereSql}`).get(...params) as { n: number }).n;

  const byLevel = (db
    .prepare(`SELECT level, count(*) AS n FROM app_logs ${whereSql} GROUP BY level ORDER BY level`)
    .all(...params) as Array<{ level: number; n: number }>).map((r) => ({
    level: NUM_LEVEL[r.level] ?? r.level,
    count: r.n,
  }));

  const topComponents = db
    .prepare(
      `SELECT component, count(*) AS n FROM app_logs ${whereSql} GROUP BY component ORDER BY n DESC LIMIT 20`,
    )
    .all(...params) as Array<{ component: string; n: number }>;

  const dbPath = resolveDbPath();
  let diskBytes = 0;
  try {
    diskBytes = fs.statSync(dbPath).size;
    for (const suffix of ['-wal', '-shm']) {
      try {
        diskBytes += fs.statSync(dbPath + suffix).size;
      } catch {
        /* missing is fine */
      }
    }
  } catch {
    /* ignore */
  }

  const out = {
    dbPath,
    diskBytes,
    diskMB: Math.round((diskBytes / 1024 / 1024) * 100) / 100,
    total,
    byLevel,
    topComponents: topComponents.map((r) => ({ component: r.component, count: r.n })),
    filters: {
      since: flags.since ?? null,
      until: flags.until ?? null,
      level: flags.level ?? null,
      component: flags.component ?? null,
      grep: flags.grep ?? null,
      trace: flags.trace ?? null,
    },
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ──────────────────────────────────────────────────────────────────────
// 分发
// ──────────────────────────────────────────────────────────────────────

const SUB: Record<string, (p: Parsed) => Promise<void>> = {
  query: cmdQuery,
  trace: cmdTrace,
  'top-errors': cmdTopErrors,
  tail: cmdTail,
  schema: cmdSchema,
  sql: cmdSql,
  stats: cmdStats,
};

async function main() {
  let parsed: Parsed;
  try {
    parsed = parseArgv();
  } catch (err) {
    process.stderr.write(`argv error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  const fn = SUB[parsed.sub];
  if (!fn) {
    process.stderr.write(`unknown subcommand: ${parsed.sub}\n\n${HELP}`);
    process.exit(1);
  }
  try {
    await fn(parsed);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    if (err instanceof Error && err.stack && process.env.DEBUG) {
      process.stderr.write(err.stack + '\n');
    }
    process.exit(1);
  }
}

main();
