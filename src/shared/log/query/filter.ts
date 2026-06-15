import { LEVEL_NUM, type LogQueryFilter } from '../types';

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
}

export interface BuiltWhere {
  where: string[];
  params: unknown[];
}

const SELECT_FIELDS =
  'id, ts, level, process_type, pid, component, msg, trace_id, span_id, parent_span_id, err_message, err_stack, window_id, life_id, fields';

// 把 glob 通配符 * 转成 LIKE 的 %；? 转成 _；同时对原本的 % / _ 转义。
export function globToLike(g: string): string {
  return g
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '%')
    .replace(/\?/g, '_');
}

// 把 LogQueryFilter 翻成 SQL where 子句 + 参数。供 buildQuery / 自定义聚合 SQL 共用。
export function buildWhere(filter: LogQueryFilter): BuiltWhere {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.since != null) {
    where.push('ts >= ?');
    params.push(filter.since);
  }
  if (filter.until != null) {
    where.push('ts <= ?');
    params.push(filter.until);
  }
  if (filter.levels && filter.levels.length > 0) {
    // 精确集合：level IN (?, ?, ...)。优先于 minLevel。
    const placeholders = filter.levels.map(() => '?').join(', ');
    where.push(`level IN (${placeholders})`);
    for (const lvl of filter.levels) params.push(LEVEL_NUM[lvl]);
  } else if (filter.minLevel) {
    where.push('level >= ?');
    params.push(LEVEL_NUM[filter.minLevel]);
  }
  if (filter.componentGlob) {
    where.push("component LIKE ? ESCAPE '\\'");
    params.push(globToLike(filter.componentGlob));
  }
  if (filter.traceId) {
    where.push('trace_id = ?');
    params.push(filter.traceId);
  }
  if (filter.lifeId != null) {
    where.push('life_id = ?');
    params.push(filter.lifeId);
  }
  if (filter.grep) {
    where.push('id IN (SELECT rowid FROM app_logs_fts WHERE app_logs_fts MATCH ?)');
    params.push(filter.grep);
  }
  if (filter.sinceId != null) {
    where.push('id > ?');
    params.push(filter.sinceId);
  }
  return { where, params };
}

export function buildQuery(filter: LogQueryFilter): BuiltQuery {
  const { where, params } = buildWhere(filter);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const limit = filter.limit ?? 500;
  const offset = filter.offset ?? 0;

  const sql = `SELECT ${SELECT_FIELDS} FROM app_logs ${whereSql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM app_logs ${whereSql}`;

  return {
    sql,
    params: [...params, limit, offset],
    countSql,
    countParams: [...params],
  };
}
