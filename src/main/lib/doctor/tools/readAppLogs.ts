/**
 * read_app_logs — 多模式日志查询工具。
 *
 * 三种模式（沿用 step3 前的对外契约）：
 *   - stats:   总数 + 按 level / 按 component 聚合
 *   - sources: 列出所有出现过的 component（去重、排序）
 *   - entries: 按 component / level / 时间窗 / grep 过滤返回单条
 *
 * 数据源：新 sqlite log 系统（`{userData}/logs/{dev,app}.db`），见 src/main/log/。
 * 内部查询通过 src/shared/log/query/ 复用 CLI 与 viewer 的同一套 SQL。
 *
 * 对外字段名保留 `source`（= sqlite 列 `component`）以避免改 system prompt 大段。
 */

import * as fs from 'fs';
import Database from 'better-sqlite3';
import { getLogDbPath, flushLogs } from '@main/log';
import {
  buildQuery,
  buildWhere,
  NUM_LEVEL,
  type LogLevel,
  type LogQueryFilter,
  type LogRow,
} from '@shared/log/query';

const ENTRIES_DEFAULT_LIMIT = 50;
const ENTRIES_HARD_LIMIT = 200;

const description = `Query Deskmate application runtime logs from the local sqlite log database. **This is an iterative tool that requires multiple calls with progressively narrower filters** until you have evidence that explains the Bug, or are confident the logs contain no relevant clues.

## Three modes

- \`stats\`: aggregated overview — total count, distribution by level (ERROR/WARN/INFO/DEBUG), top components by frequency (Top 15). **This should almost always be the first call** — extremely low cost, high information density.
- \`sources\`: list all component values that have appeared (deduplicated and sorted). Call this when you don't know which module names to use as a \`source\` filter.
- \`entries\`: return individual log entries (default 50, hard cap 200). Narrow with \`source\` / \`level\` / \`grep\` / \`from\` / \`to\`.

## Filter parameters (apply to all modes)

- \`source\`: component name glob match, supports \`*\` wildcard (e.g. \`"mcp*"\`, \`"*Manager"\`). Maps to sqlite column \`component\`.
- \`level\`: array of values from \`["error","warn","info","debug","trace","fatal"]\`. **Set semantics — only the listed levels are returned (SQL \`IN\`)**, not a minimum-level filter. E.g. \`["error","warn"]\` returns only error+warn (no fatal, no info).
- \`grep\`: FTS5 MATCH expression searched against \`msg + err_stack + fields\`. Examples:
  - \`"timeout"\` — single term
  - \`"timeout AND mcp"\` / \`"timeout OR network"\` — boolean
  - \`"\\"exact phrase\\""\` — quoted phrase
  - **Important**: FTS5 treats \`:\` as column-filter and \`-\` as NOT. If your search term contains those (e.g. \`timeout: mcp\`, \`pre-commit\`), **wrap it in double quotes**: \`"\\"timeout: mcp\\""\`. See https://sqlite.org/fts5.html#full_text_query_syntax
- \`from\` / \`to\`: time window, ISO 8601 or \`"YYYY-MM-DD HH:mm"\`
- \`trace\`: filter by traceId (cross-process correlation id). For full timeline of one trace, prefer the dedicated \`trace_timeline\` tool.
- \`scope\`: \`"current"\` (default — implicit \`since=midnight\`, today only) or \`"all"\` (no implicit time window). Applies to both dev and prod (both dbs accumulate across launches).

## Usage examples (query goal → parameter form)

- Get current run's log overview
  \`{ mode: "stats" }\`

- See all available component names
  \`{ mode: "sources" }\`

- Pull the most recent 30 ERROR entries
  \`{ mode: "entries", level: ["error"], limit: 30 }\`

- See only errors and warnings from MCP-related components
  \`{ mode: "entries", source: "mcp*", level: ["error","warn"], limit: 30 }\`

- FTS5: search for logs containing "timeout" and "mcp"
  \`{ mode: "entries", grep: "timeout AND mcp", limit: 20 }\`

- Pin a time window
  \`{ mode: "entries", from: "2026-04-22 14:00", to: "2026-04-22 15:00", level: ["error","warn"] }\`

- Multi-dimensional narrowing
  \`{ mode: "entries", source: "Mcp*", level: ["error"], grep: "timeout", limit: 20 }\`

## Notes

- When entries mode shows a truncation notice, do not try to pull more — instead narrow the filters (add source, level, or grep) and query again.
- Don't be afraid to call multiple times. Narrowing one dimension per call is more effective than blindly pulling a huge dump of logs.
- If 2–3 consecutive narrowed queries return no related results, conclude "no relevant clues in logs" and proceed to the next phase.
- Call \`get_log_schema\` once to see field definitions before iterating heavily.
- Use \`trace_timeline\` when you have a specific traceId to follow end-to-end.`;

export const readAppLogsToolDef = {
  type: 'function' as const,
  function: {
    name: 'read_app_logs',
    description,
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['stats', 'sources', 'entries'],
          description: `stats = aggregated overview; sources = list of unique component values; entries = actual log rows filtered by the criteria below.`,
        },
        source: {
          type: 'string',
          description: `Glob pattern to filter by component, supports "*" wildcard (e.g. "mcp*", "chat*"). Applies to all modes.`,
        },
        level: {
          type: 'array',
          items: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
          description: 'Filter by level. Set semantics: only the listed levels are returned (SQL IN), not a minimum-level filter.',
        },
        grep: {
          type: 'string',
          description: `FTS5 MATCH expression against msg + err_stack + fields. SQLite FTS5 syntax (AND/OR/NOT/NEAR/phrase).`,
        },
        from: {
          type: 'string',
          description: 'Start time (inclusive). ISO 8601 or "YYYY-MM-DD HH:mm".',
        },
        to: {
          type: 'string',
          description: 'End time (inclusive). ISO 8601 or "YYYY-MM-DD HH:mm".',
        },
        trace: {
          type: 'string',
          description: 'Filter by traceId. For one full trace, prefer the trace_timeline tool.',
        },
        limit: {
          type: 'number',
          description: `Max entries to return (only applies to mode="entries"). Default ${ENTRIES_DEFAULT_LIMIT}, hard cap ${ENTRIES_HARD_LIMIT}.`,
        },
        scope: {
          type: 'string',
          enum: ['current', 'all'],
          description: `Default "current" adds an implicit \`since=midnight\` (today only). "all" removes it. Applies to both dev and prod (both dbs accumulate across launches).`,
        },
      },
      required: ['mode'],
    },
  },
};

interface ReadAppLogsArgs {
  mode: 'stats' | 'sources' | 'entries';
  source?: string;
  level?: string[];
  grep?: string;
  from?: string;
  to?: string;
  trace?: string;
  limit?: number;
  scope?: 'current' | 'all';
}

const VALID_MODES = ['stats', 'sources', 'entries'] as const;
const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const VALID_SCOPES = ['current', 'all'] as const;
const KNOWN_KEYS = new Set(['mode', 'source', 'level', 'grep', 'from', 'to', 'trace', 'limit', 'scope']);
// 单次响应中保留的样本聚合统计上限。Stats 与 sources 模式内部用全表，无 hard cap。
const STATS_TOP_N = 15;

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const dbPath = getLogDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`log db not found at ${dbPath}; the worker may not have written yet`);
  }
  _db = new Database(dbPath, { readonly: true, fileMustExist: true });
  _db.pragma('busy_timeout = 1000');
  return _db;
}

export async function executeReadAppLogs(args: ReadAppLogsArgs): Promise<string> {
  const validation = validateArgs(args);
  if (validation) return validation;

  // 读 db 前 flush，避免 worker 还在缓冲队列里的事件被"消失"。flushLogs 内部已对未初始化场景 no-op。
  try {
    await flushLogs();
  } catch {
    // flush 失败不阻塞查询（用户最差也就是少看到几条最新行）
  }

  try {
    let connection: Database.Database;
    try {
      connection = db();
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }

    const scope = args.scope ?? 'current';
    const baseFilter: LogQueryFilter = {};
    const implicitSince = applyTimeWindow(baseFilter, args, scope);
    if (args.trace) baseFilter.traceId = args.trace;
    if (args.source) baseFilter.componentGlob = args.source;
    if (args.grep) baseFilter.grep = args.grep;
    if (args.level && args.level.length > 0) {
      baseFilter.levels = args.level.map((l) => l.toLowerCase() as LogLevel);
    }

    const header = buildScopeAndStalenessHeader(connection, scope, implicitSince);
    let body: string;
    if (args.mode === 'stats') {
      body = runStats(connection, baseFilter);
    } else if (args.mode === 'sources') {
      body = runSources(connection, baseFilter);
    } else {
      body = runEntries(connection, baseFilter, args.limit);
    }
    return header + body;
  } catch (err) {
    return formatQueryError(err);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Modes
// ──────────────────────────────────────────────────────────────────────

function runStats(connection: Database.Database, filter: LogQueryFilter): string {
  // 复用 buildQuery 的 where 子句（不取 SELECT 列表 / ORDER / LIMIT）。这里直接重建。
  const { where, params } = buildWhere(filter);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (connection.prepare(`SELECT count(*) AS n FROM app_logs ${whereSql}`).get(...params) as { n: number }).n;

  const byLevel = connection
    .prepare(`SELECT level, count(*) AS n FROM app_logs ${whereSql} GROUP BY level ORDER BY level`)
    .all(...params) as Array<{ level: number; n: number }>;

  const topComponents = connection
    .prepare(`SELECT component, count(*) AS n FROM app_logs ${whereSql} GROUP BY component ORDER BY n DESC LIMIT ?`)
    .all(...params, STATS_TOP_N) as Array<{ component: string; n: number }>;

  const lines: string[] = [];
  lines.push(`[Stats] total=${total}`);
  if (byLevel.length === 0) {
    lines.push('No matching rows.');
    return lines.join('\n');
  }
  lines.push('By level:');
  for (const r of byLevel) {
    lines.push(`  ${(NUM_LEVEL[r.level] ?? r.level).toString().padEnd(6)} ${r.n}`);
  }
  lines.push(`Top components (top ${STATS_TOP_N}):`);
  for (const r of topComponents) {
    lines.push(`  ${String(r.n).padStart(6)}  ${r.component}`);
  }
  return lines.join('\n');
}

function runSources(connection: Database.Database, filter: LogQueryFilter): string {
  const { where, params } = buildWhere(filter);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = connection
    .prepare(`SELECT DISTINCT component FROM app_logs ${whereSql} ORDER BY component`)
    .all(...params) as Array<{ component: string }>;
  if (rows.length === 0) return 'No component values found in the current scope.';
  return rows.map((r) => r.component).join('\n');
}

function runEntries(connection: Database.Database, filter: LogQueryFilter, rawLimit: number | undefined): string {
  const limit = clampLimit(rawLimit);
  // 先 count 一次以判断是否被截断（buildQuery 的 LIMIT 不告诉我们总数）
  const { countSql, countParams, sql, params } = buildQuery({ ...filter, limit });
  const total = (connection.prepare(countSql).get(...countParams) as { n: number }).n;
  const rows = connection.prepare(sql).all(...params) as LogRow[];

  if (rows.length === 0) {
    return buildEmptyEntriesHint(filter, total);
  }

  // 时间窗按时间正序更利于人眼阅读
  rows.reverse();
  const body = rows.map(formatRow).join('\n');
  const truncatedNote =
    total > rows.length
      ? `\n\n[... ${total - rows.length} more entries truncated. Narrow filters or use mode="stats" for an overview.]`
      : '';
  return body + truncatedNote;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

// 应用时间窗。返回 implicit since（仅当 scope='current' 且 prod 时非空），用于在响应头里告知 LLM。
function applyTimeWindow(
  filter: LogQueryFilter,
  args: ReadAppLogsArgs,
  scope: 'current' | 'all',
): number | null {
  if (args.from) filter.since = parseDateTime(args.from).getTime();
  if (args.to) filter.until = parseDateTime(args.to).getTime();
  if (args.from || scope !== 'current') return null;
  // dev / prod 都跨启动累积；统一加 since=midnight 表示"今天"。
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  filter.since = start.getTime();
  return start.getTime();
}

function buildScopeAndStalenessHeader(
  connection: Database.Database,
  scope: 'current' | 'all',
  implicitSince: number | null,
): string {
  const parts: string[] = [];
  if (scope === 'current' && implicitSince != null) {
    parts.push(
      `[Scope] current — implicit since=${new Date(implicitSince).toISOString()} (today only). Use scope="all" to widen.`,
    );
  } else if (scope === 'all') {
    parts.push(`[Scope] all — no implicit time window.`);
  }
  try {
    // max(ts) 走 idx_logs_ts，O(log N)。**不**做 count(*)：在累积久的 prod app.db 上是全表扫描，
    // 且全库总数对 LLM 容易误解为"当前 scope 行数"。如需行数，让 LLM 显式调 stats 模式。
    const row = connection.prepare('SELECT max(ts) AS last_ts FROM app_logs').get() as {
      last_ts: number | null;
    };
    const now = Date.now();
    if (row.last_ts) {
      const ageSec = Math.max(0, Math.round((now - row.last_ts) / 1000));
      parts.push(
        `[DB] last entry at ${new Date(row.last_ts).toISOString()} (${ageSec}s ago), now=${new Date(now).toISOString()}`,
      );
    } else {
      parts.push(`[DB] empty; now=${new Date(now).toISOString()}`);
    }
  } catch {
    // 拿不到 staleness 就算了，不让 header 失败拖垮主查询
  }
  return parts.length ? parts.join('\n') + '\n\n' : '';
}

// 把 sqlite/FTS5 等底层错误翻成对 LLM 可操作的提示。
function formatQueryError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fts5:/i.test(msg)) {
    return (
      `Error reading logs (FTS5): ${msg}\n` +
      `Hint: SQLite FTS5 treats ":" as column-filter and "-" as NOT. ` +
      `Wrap terms containing those (or other punctuation) in double quotes: e.g. grep: "\\"timeout: mcp\\"".`
    );
  }
  return `Error reading logs: ${msg}`;
}

function formatRow(r: LogRow): string {
  const lvl = (NUM_LEVEL[r.level] ?? String(r.level)).toUpperCase().padEnd(5);
  const ts = new Date(r.ts).toISOString();
  const trace = r.trace_id ? ` trace=${r.trace_id}` : '';
  const fields = r.fields ? ` ${r.fields}` : '';
  const err = r.err_stack ? `\n  ${r.err_stack.split('\n').join('\n  ')}` : '';
  return `${ts} ${lvl} [${r.process_type}/${r.component}]${trace} ${r.msg}${fields}${err}`;
}

function buildEmptyEntriesHint(filter: LogQueryFilter, totalScanned: number): string {
  if (totalScanned === 0) {
    return 'No log entries match the given filters. 0 rows in the current scope — the db may be empty or the time window has no events yet.';
  }
  const active: string[] = [];
  if (filter.componentGlob) active.push(`source="${filter.componentGlob}"`);
  if (filter.levels && filter.levels.length > 0) active.push(`level=[${filter.levels.join(',')}]`);
  else if (filter.minLevel) active.push(`minLevel="${filter.minLevel}"`);
  if (filter.grep) active.push(`grep="${filter.grep}"`);
  if (filter.since) active.push(`from="${new Date(filter.since).toISOString()}"`);
  if (filter.until) active.push(`to="${new Date(filter.until).toISOString()}"`);
  if (filter.traceId) active.push(`trace="${filter.traceId}"`);
  const f = active.length ? ` (filters: ${active.join(', ')})` : '';
  return `No log entries match the given filters${f}. ${totalScanned} entries in scope before filtering.`;
}

function clampLimit(raw: number | undefined): number {
  if (!raw || raw <= 0) return ENTRIES_DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), ENTRIES_HARD_LIMIT);
}

function parseDateTime(s: string): Date {
  // 支持 ISO 8601 与 "YYYY-MM-DD HH:mm" 两种格式
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(s);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  }
  return new Date(NaN);
}

function validateArgs(args: ReadAppLogsArgs): string | null {
  if (!args || typeof args !== 'object') {
    return 'Error: arguments must be an object.';
  }
  if (!args.mode || !VALID_MODES.includes(args.mode)) {
    return `Error: "mode" is required and must be one of ${VALID_MODES.map((m) => `"${m}"`).join(' | ')}. Got: ${JSON.stringify(args.mode)}.`;
  }
  const unknown = Object.keys(args).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length > 0) {
    return `Error: unknown parameter(s): ${unknown.join(', ')}. Valid keys: ${[...KNOWN_KEYS].join(', ')}.`;
  }
  if (args.level !== undefined) {
    if (!Array.isArray(args.level)) return 'Error: "level" must be an array of strings.';
    const bad = args.level.filter((l) => !VALID_LEVELS.has(String(l).toLowerCase()));
    if (bad.length > 0) {
      return `Error: invalid level value(s): ${bad.join(', ')}. Valid: ${[...VALID_LEVELS].join(', ')}.`;
    }
  }
  if (args.scope !== undefined && !VALID_SCOPES.includes(args.scope)) {
    return `Error: "scope" must be one of ${VALID_SCOPES.map((s) => `"${s}"`).join(' | ')}. Got: ${JSON.stringify(args.scope)}.`;
  }
  if (args.from !== undefined && (typeof args.from !== 'string' || Number.isNaN(parseDateTime(args.from).getTime()))) {
    return `Error: "from" is not a recognizable timestamp. Use ISO 8601 or "YYYY-MM-DD HH:mm". Got: ${JSON.stringify(args.from)}.`;
  }
  if (args.to !== undefined && (typeof args.to !== 'string' || Number.isNaN(parseDateTime(args.to).getTime()))) {
    return `Error: "to" is not a recognizable timestamp. Use ISO 8601 or "YYYY-MM-DD HH:mm". Got: ${JSON.stringify(args.to)}.`;
  }
  if (args.from && args.to && parseDateTime(args.from) > parseDateTime(args.to)) {
    return `Error: "from" (${args.from}) is later than "to" (${args.to}). Time window is empty.`;
  }
  if (args.grep !== undefined && (typeof args.grep !== 'string' || args.grep.length === 0)) {
    return 'Error: "grep" must be a non-empty string.';
  }
  if (args.source !== undefined && (typeof args.source !== 'string' || args.source.length === 0)) {
    return 'Error: "source" must be a non-empty glob string.';
  }
  if (args.trace !== undefined && (typeof args.trace !== 'string' || args.trace.length === 0)) {
    return 'Error: "trace" must be a non-empty string.';
  }
  if (args.limit !== undefined && (typeof args.limit !== 'number' || !Number.isFinite(args.limit) || args.limit <= 0)) {
    return `Error: "limit" must be a positive number. Got: ${JSON.stringify(args.limit)}.`;
  }
  return null;
}
