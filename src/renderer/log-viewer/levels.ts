// 行渲染辅助：level → 颜色 class / 文字 / 时间格式化。
//
// 颜色不再返回 css var，而是 tailwind utility class（`bg-lvl-info` / `text-lvl-warn`），
// 由 styles.css 的 @theme 自动生成。透明度变体走 tailwind 自带 `/数字` 语法。

import { NUM_LEVEL, type LogLevel } from '@shared/log/types';

export const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

export const LEVEL_NUM: Record<LogLevel, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

export function levelName(n: number): LogLevel {
  return NUM_LEVEL[n] ?? 'info';
}

// 各组件按需 cn() 拼接，例如：
//   <span className={cn('rounded px-1.5 text-[10px] uppercase', levelTextClass(level))}>
//   <span className={cn('h-1.5 w-1.5 rounded-full', levelDotClass(level))}>
//   <div className={levelTintBgClass(level)}>  // 10% 透明底
//   <div className={levelTintBorderClass(level)}>
export function levelTextClass(n: number): string {
  return TEXT[levelName(n)];
}
export function levelDotClass(n: number): string {
  return DOT[levelName(n)];
}
export function levelTintBgClass(n: number): string {
  return TINT_BG[levelName(n)];
}
export function levelTintBorderClass(n: number): string {
  return TINT_BORDER[levelName(n)];
}

const TEXT: Record<LogLevel, string> = {
  trace: 'text-lvl-trace',
  debug: 'text-lvl-debug',
  info:  'text-lvl-info',
  warn:  'text-lvl-warn',
  error: 'text-lvl-error',
  fatal: 'text-lvl-fatal',
};
const DOT: Record<LogLevel, string> = {
  trace: 'bg-lvl-trace',
  debug: 'bg-lvl-debug',
  info:  'bg-lvl-info',
  warn:  'bg-lvl-warn',
  error: 'bg-lvl-error',
  fatal: 'bg-lvl-fatal',
};
const TINT_BG: Record<LogLevel, string> = {
  trace: 'bg-lvl-trace/10',
  debug: 'bg-lvl-debug/10',
  info:  'bg-lvl-info/10',
  warn:  'bg-lvl-warn/10',
  error: 'bg-lvl-error/10',
  fatal: 'bg-lvl-fatal/10',
};
const TINT_BORDER: Record<LogLevel, string> = {
  trace: 'border-lvl-trace/30',
  debug: 'border-lvl-debug/30',
  info:  'border-lvl-info/30',
  warn:  'border-lvl-warn/30',
  error: 'border-lvl-error/30',
  fatal: 'border-lvl-fatal/30',
};

// SVG 场景下用（fill/stroke 等不吃 class），仅供 TracesView 这类 svg 渲染用。
export function levelCssVar(n: number): string {
  return CSS_VAR[levelName(n)];
}
const CSS_VAR: Record<LogLevel, string> = {
  trace: 'var(--color-lvl-trace)',
  debug: 'var(--color-lvl-debug)',
  info:  'var(--color-lvl-info)',
  warn:  'var(--color-lvl-warn)',
  error: 'var(--color-lvl-error)',
  fatal: 'var(--color-lvl-fatal)',
};

// HH:mm:ss.SSS（本地）。dev viewer 的实用价值在毫秒精度而非日期。
export function formatTs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  if (diff < 1_000) return `${diff}ms ago`;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
