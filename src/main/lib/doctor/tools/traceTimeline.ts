/**
 * trace_timeline — 给定 traceId，按时间排序返回完整事件序列。
 * 适合定位一次跨进程操作（如 chat 流式请求、MCP 工具调用）的端到端时间线。
 */

import type { Tool } from '@earendil-works/pi-ai';
import { jsonSchema } from '@main/pi';
import * as fs from 'fs';
import Database from 'better-sqlite3';
import { getLogDbPath, flushLogs } from '@main/log';
import { NUM_LEVEL, type LogRow } from '@shared/log/query';

const ROW_HARD_LIMIT = 500;

export const traceTimelineToolDef: Tool = {
  name: 'trace_timeline',
  description:
    'Given a traceId, return all log rows correlated to it, ordered by time. Use after you spotted a traceId in read_app_logs and want the full cross-process timeline.',
  parameters: jsonSchema({
    type: 'object',
    properties: {
      traceId: {
        type: 'string',
        description: 'The trace identifier (column `trace_id`). Often surfaced by an earlier read_app_logs call.',
      },
      limit: {
        type: 'number',
        description: `Max rows to return; hard cap ${ROW_HARD_LIMIT}. Default 200.`,
      },
    },
    required: ['traceId'],
  }),
};

interface Args {
  traceId?: string;
  limit?: number;
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const dbPath = getLogDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`log db not found at ${dbPath}`);
  }
  _db = new Database(dbPath, { readonly: true, fileMustExist: true });
  _db.pragma('busy_timeout = 1000');
  return _db;
}

export async function executeTraceTimeline(args: Args): Promise<string> {
  if (!args || typeof args !== 'object') return 'Error: arguments must be an object.';
  if (!args.traceId || typeof args.traceId !== 'string') {
    return 'Error: "traceId" is required.';
  }
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 200)), ROW_HARD_LIMIT);

  try {
    await flushLogs();
  } catch {
    // 见 readAppLogs.ts：flush 失败不阻塞查询
  }

  let connection: Database.Database;
  try {
    connection = db();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const rows = connection
    .prepare(
      'SELECT id, ts, level, process_type, pid, component, msg, trace_id, span_id, parent_span_id, err_message, err_stack, window_id, life_id, fields ' +
        'FROM app_logs WHERE trace_id = ? ORDER BY ts ASC, id ASC LIMIT ?',
    )
    .all(args.traceId, limit) as LogRow[];

  if (rows.length === 0) {
    return `No rows found for traceId=${args.traceId}.`;
  }

  const total = (connection.prepare('SELECT count(*) AS n FROM app_logs WHERE trace_id = ?').get(args.traceId) as {
    n: number;
  }).n;

  const lines = rows.map((r) => {
    const lvl = (NUM_LEVEL[r.level] ?? String(r.level)).toUpperCase().padEnd(5);
    const ts = new Date(r.ts).toISOString();
    const span = r.span_id
      ? r.parent_span_id
        ? ` span=${r.span_id} parent=${r.parent_span_id}`
        : ` span=${r.span_id}`
      : '';
    const fields = r.fields ? ` ${r.fields}` : '';
    const err = r.err_stack ? `\n  ${r.err_stack.split('\n').join('\n  ')}` : '';
    return `${ts} ${lvl} [${r.process_type}/${r.component}]${span} ${r.msg}${fields}${err}`;
  });

  const trailer = total > rows.length ? `\n\n[... ${total - rows.length} more rows in trace; raise --limit to see them]` : '';
  return lines.join('\n') + trailer;
}
