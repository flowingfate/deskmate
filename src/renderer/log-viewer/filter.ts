// 过滤器表单状态。UI 文本输入用 string；提交时 parser 转成数字字段送 buildQuery。
// 不在 LogQueryFilter 之上再封一层 hook —— filter 是受控状态，由 App 持有，FilterBar 只是受控表单。

import type { LogLevel, LogQueryFilter } from '@shared/log/types';
import { parseSince, parseUntil } from '@shared/log/query';

export interface FilterForm {
  since: string;          // 默认 '15m'
  until: string;          // 空表示 now
  minLevel: LogLevel | ''; // '' 表示不限
  componentGlob: string;
  grep: string;
  traceId: string;
  // life 锚点：number 表示限定到该 life；null 表示不限（默认）。
  // 用 number 而不是 string —— life_id 永远是 IPC 直传的整数，不存在解析失败路径。
  lifeId: number | null;
}

export const DEFAULT_FORM: FilterForm = {
  since: '15m',
  until: '',
  minLevel: '',
  componentGlob: '',
  grep: '',
  traceId: '',
  lifeId: null,
};

export interface BuildFilterResult {
  filter: LogQueryFilter;
  error: string | null;
}

// 把表单 string → LogQueryFilter。任何字段解析失败返回 error，由上层呈现。
export function buildFilterFromForm(form: FilterForm, limit = 500): BuildFilterResult {
  const filter: LogQueryFilter = { limit };
  try {
    if (form.since.trim()) filter.since = parseSince(form.since);
    if (form.until.trim()) filter.until = parseUntil(form.until);
    if (form.minLevel) filter.minLevel = form.minLevel;
    if (form.componentGlob.trim()) filter.componentGlob = form.componentGlob.trim();
    if (form.grep.trim()) filter.grep = form.grep.trim();
    if (form.traceId.trim()) filter.traceId = form.traceId.trim();
    if (form.lifeId != null) filter.lifeId = form.lifeId;
    return { filter, error: null };
  } catch (e) {
    return { filter: { limit }, error: e instanceof Error ? e.message : String(e) };
  }
}
