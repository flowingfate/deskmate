// 日志系统共享类型定义。
// 同时被 main / renderer / worker / scripts / log-viewer 引用。
//
// 字段命名故意短：日志调用密集，长字段名会让代码噪音翻倍。
//   mod = component / module，业务模块名
//   tid = trace id（一次跨进程调用链）
//   sid = span id（trace 内某段操作）
//   psid = parent span id（嵌套 span，重建调用树用；顶层 span 留空）
//   dur = duration（毫秒）
//   err = error
// sqlite 列名仍是完整词（component / trace_id / span_id），由 sqlite-transport 做映射。

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type ProcessType = 'main' | 'renderer' | 'worker';

export interface LogFields {
  mod?: string;
  msg: string;
  tid?: string;
  sid?: string;
  psid?: string;
  err?: unknown;
  dur?: number;
  // ── 以下字段由 main 端（IPC handler / pino / sqlite-transport）自动注入 ──
  // 业务无需手动传；写在这里仅为文档化"哪些字段会出现在落库记录里"，
  // 并让查询层 / log viewer 拿到类型，而不是 string 兜底。
  processType?: ProcessType;  // main / renderer / worker
  windowId?: number;          // renderer 进程的 webContents id
  pid?: number;               // 进程 pid（pino 自动加）
  [key: string]: unknown;
}

export interface Logger {
  trace(fields: LogFields): void;
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
  fatal(fields: LogFields): void;
  child(bindings: Partial<LogFields>): Logger;
  flush(): Promise<void>;
}

export const LEVEL_NUM: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export const NUM_LEVEL: Record<number, LogLevel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export interface LogRow {
  id: number;
  ts: number;
  level: number;
  process_type: ProcessType;
  pid: number;
  component: string;
  msg: string;
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  err_message: string | null;
  err_stack: string | null;
  window_id: number | null;
  life_id: number;
  fields: string | null;
}

export interface LogQueryFilter {
  since?: number;
  until?: number;
  // 最低 level（含）。与 `levels` 互斥；若两者都给，levels 优先。
  minLevel?: LogLevel;
  // level 集合精确匹配（SQL IN）。给一组 ['error', 'info'] 时只返回 error 与 info，不返回 warn。
  levels?: LogLevel[];
  componentGlob?: string;
  traceId?: string;
  // 单次 app 生命周期标识。viewer 默认按 life 隔离查询：跨重启的旧日志不会混入当前 life 视图。
  // life_id 是 worker 启动时按 (prevLife % maxRows) + 1 分配，范围 [1, maxRows]。
  lifeId?: number;
  grep?: string;
  // 增量拉取游标：只返回 id 严格大于该值的行。供 viewer follow 模式使用。
  sinceId?: number;
  limit?: number;
  offset?: number;
}
