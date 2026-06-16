// AnimatedHeight — RO 驱动的高度动画容器。
//
// 内层 RO 跟踪子节点自然高度 → 写回外层显式 px height → CSS transition 平滑。
// 外层 box-sizing:content-box,防 Tailwind border-box 下 padding 侵蚀内容区。
// CSS transition 由外部 class 声明,本组件不注入 transition。
//
// 滚动锚定: 在 height 过渡期间用 rAF 循环逐帧补偿 scrollTop,
// 防止 column-reverse 列表里展开时内容上滑。首次 mount 跳过。

import React, { useLayoutEffect, useRef } from 'react';

export interface AnimatedHeightProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'style'> {
  children: React.ReactNode;
  duration?: number;
  isLive?: boolean;
}

const DISARM_BUFFER_MS = 120;
export const CHAT_SCROLL_BOX_CLS = 'chat-container-reverse';

export const AnimatedHeight: React.FC<AnimatedHeightProps> = ({
  children,
  duration = 200,
  isLive,
  className,
  ...restProps
}) => {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);

  // ref 化 props → RO 回调 / rAF 循环始终读到最新值。
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const isLiveRef = useRef(isLive);
  isLiveRef.current = isLive;

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return;

    let initialized = false;
    let raf = 0;

    function startAnchorLoop(patch: VoidFunction) {
      cancelAnimationFrame(raf);
      const deadline = performance.now() + durationRef.current + DISARM_BUFFER_MS;
      const tick = () => {
        if (performance.now() >= deadline) return raf = 0;
        patch();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    // RO 只观察 inner,不观察 outer。
    const ro = new ResizeObserver(() => {
      const next = `${inner.offsetHeight}px`;
      if (outer.style.height === next) return;

      if (!isLiveRef.current && initialized) {
        const scrollEl = outer.closest(`.${CHAT_SCROLL_BOX_CLS}`) as HTMLElement | null;
        if (scrollEl) {
          // 先获取 base，再写入 next height，最后启动 rAF 循环补偿 scrollTop。
          const base = outer.getBoundingClientRect().top;
          outer.style.height = next;
          startAnchorLoop(() => {
            const delta = outer.getBoundingClientRect().top - base;
            if (delta) scrollEl.scrollTop += delta;
          });
          initialized = true;
          return;
        }
      }

      outer.style.height = next;
      initialized = true;
    });

    ro.observe(inner);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={outerRef}
      {...restProps}
      className={className}
      style={{
        height: 0,
        overflow: 'hidden',
        boxSizing: 'content-box',
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
};

export default AnimatedHeight;
