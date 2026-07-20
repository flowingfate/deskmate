// Renderer 进程统一 logger 入口。
//   import { log } from '@/log';
//   const compLog = log.child({ mod: 'ChatView' });
//   compLog.info({ msg: 'ready' });
//
// 走 preload 暴露的 electronAPI.log → main 'log:write' / 'log:writeBatch'。
// 进程类型 / 窗口 ID 由 main handler 强行注入，这里传也会被覆写。
//
// renderer 故意不暴露 flush —— renderer 不读 sqlite，等 worker 落盘没有任何意义；
// flush 由 main 自己在菜单 / Doctor reader / before-quit 时触发。
// IPC 通道天然有序：renderer 一连串 log:write 到达 main 时排在所有后续操作前面。
//
// 批量策略：
// - debug/trace/info 进 buffer，每 50ms flush 一次或满 50 条立即；
// - warn/error/fatal 立即触发整批 flush，保证崩溃前 error 链不丢失；
// - pagehide / visibilitychange→hidden 时立即 flush 防 unload 丢数据。
// 单向 send 跨 IPC 仍有 ~0.1ms 边界成本，dev 高频流式 chat 下每秒数百条积累出体感卡。

import type { LogFields, LogLevel } from '@shared/log/types';
import { LEVEL_NUM } from '@shared/log/types';

export interface RendererLogger {
  trace(fields: LogFields): void;
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
  fatal(fields: LogFields): void;
  child(bindings: Partial<LogFields>): RendererLogger;
}

const EMOJI: Record<LogLevel, string> = {
  trace: '🔍', debug: '🔎', info: 'ℹ️', warn: '⚠️', error: '❌', fatal: '💀',
};

const IS_DEV = (() => {
  try {
    return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
})();

const MIN_LEVEL_NUM = IS_DEV ? LEVEL_NUM.trace : LEVEL_NUM.info;

// ─── batch buffer ──────────────────────────────────────────────────────
const BATCH_FLUSH_MS = 50;
const BATCH_MAX_SIZE = 50;
const URGENT_LEVEL = LEVEL_NUM.warn; // >= warn 立即触发 flush

interface PendingEntry { level: LogLevel; fields: LogFields }

const pending: PendingEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  // 单条仍走旧通道，避免 batch 开销；批量走新通道。
  if (batch.length === 1) {
    window.electronAPI.log.write(batch[0].level, batch[0].fields);
  } else {
    window.electronAPI.log.writeBatch(batch);
  }
}

function scheduleFlush(): void {
  if (timer != null) return;
  timer = setTimeout(flush, BATCH_FLUSH_MS);
}

function enqueue(level: LogLevel, fields: LogFields): void {
  pending.push({ level, fields });
  if (LEVEL_NUM[level] >= URGENT_LEVEL || pending.length >= BATCH_MAX_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

// 页面卸载 / 隐藏前兜底 flush。pagehide 是 unload 的替代（bfcache 友好）。
// 只在浏览器环境注册（vitest jsdom 也有 window，但没关系——pending 空就 noop）。
if (typeof window !== 'undefined') {
  const flushNow = () => flush();
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function call(level: LogLevel, fields: LogFields, bindings?: Partial<LogFields>): void {
  const levelNum = LEVEL_NUM[level];
  if (levelNum < MIN_LEVEL_NUM) return;

  // bindings 不允许被覆盖
  fields = bindings ? { ...fields, ...bindings } : fields;

  if (IS_DEV && levelNum >= LEVEL_NUM.warn) {
    const mod = typeof fields.mod === 'string' ? `[${fields.mod}]` : '';
    const method = level === 'warn' ? 'warn' : 'error';
    console[method](`${EMOJI[level]} ${mod}`, fields.msg, fields);
  }

  enqueue(level, fields);
}

function make(base?: Partial<LogFields>): RendererLogger {

  let bindings: Partial<LogFields> | undefined;
  if (base) {
    delete base.msg; // 预防误传，message 是 pino 专用字段，不允许用户绑定
    let valid = false;
    Object.keys(base).forEach((k: keyof LogFields) => {
      if (base[k] === undefined) delete base[k];
      else valid = true;
    });
    if (valid) bindings = base;
  }

  return {
    trace: (f) => call('trace', f, bindings),
    debug: (f) => call('debug', f, bindings),
    info: (f) => call('info', f, bindings),
    warn: (f) => call('warn', f, bindings),
    error: (f) => call('error', f, bindings),
    fatal: (f) => call('fatal', f, bindings),
    child: (b) => bindings ? make({ ...bindings, ...b }) : make(b),
  };
}

export const log: RendererLogger = make();
