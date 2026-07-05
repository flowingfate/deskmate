import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 带宽限期的 hover 意图。
 * leave 后延迟 `graceMs` 才真正判定移出，用于兜住 trigger 与浮层之间的像素间隙
 * （鼠标途经间隙时不会误触发关闭）。卸载时清理挂起的定时器。
 */
export function useHoverIntent(graceMs: number) {
  const [hovered, setHovered] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);

  const enter = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setHovered(true);
  }, []);

  const leave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHovered(false), graceMs);
  }, [graceMs]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { hovered, enter, leave };
}

/**
 * 每当 `triggerAt`（一个单调递增的时间戳）变化，返回 true 并在 `durationMs` 后自动回落 false。
 * 用于「新 step 到达时自动闪出 tooltip 2 秒」。`triggerAt` 不变则保持当前值。
 */
export function useAutoWindow(triggerAt: number | undefined, durationMs: number): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!triggerAt) return;
    setActive(true);
    const t = setTimeout(() => setActive(false), durationMs);
    return () => clearTimeout(t);
  }, [triggerAt, durationMs]);

  return active;
}
