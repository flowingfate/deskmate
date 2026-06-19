import React, { useLayoutEffect, useRef } from 'react';
import { cn } from '@renderer/lib/utilities';

export interface AnimatedSectionBodyProps {
  children: React.ReactNode;
  className?: string;
  /** 高度过渡时长（ms） */
  duration?: number;
}

/**
 * RO 驱动的高度动画容器 —— 策略借鉴 chat/tool/AnimatedHeight：
 * 内层 `ResizeObserver` 跟踪 children 自然高度 → 写回外层显式 px `height`
 * → 由 CSS transition 平滑过渡，把 loading / empty / 文件树之间的状态切换
 * 从"生硬跳动"变成顺滑伸缩。
 *
 * 与 AnimatedHeight 的差异（有意为之）：
 * - 不含 column-reverse 聊天列表的滚动锚定逻辑 —— workspace 不在那个滚动盒里。
 * - 首次测量瞬时落位（临时关 transition + 强制 reflow），避免面板展开时
 *   0 → 内容高度 的挂载抖动；之后内容变化才走动画。
 *
 * inline `height: 0` 故意保持不变：React diff 始终认为 height 未变，不会覆盖
 * 命令式写入的真实高度（与 AnimatedHeight 同一技巧）。
 */
export const AnimatedSectionBody: React.FC<AnimatedSectionBodyProps> = ({
  children,
  className,
  duration = 220,
}) => {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let initialized = false;

    const apply = () => {
      const next = `${inner.offsetHeight}px`;
      if (outer.style.height === next) return;

      if (!initialized) {
        // 首帧瞬时落位：关 transition → 写高度 → 强制 reflow → 复原 transition
        const prevTransition = outer.style.transition;
        outer.style.transition = 'none';
        outer.style.height = next;
        void outer.offsetHeight;
        outer.style.transition = prevTransition;
        initialized = true;
        return;
      }

      outer.style.height = next;
    };

    apply();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outerRef}
      className={cn('overflow-hidden', className)}
      style={{
        height: 0,
        boxSizing: 'content-box',
        transition: `height ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
};

export default AnimatedSectionBody;
