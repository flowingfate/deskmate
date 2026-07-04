import React, { useEffect, useState } from 'react';
import { RightPaneCollapsedAtom, RightPaneSizeAtom } from '@/states/right-pane.atom';

/** Matches the CSS transition duration in RightGlobalSidepane.css */
const COLLAPSE_ANIMATION_MS = 250;

/**
 * Returns whether the component should remain mounted.
 * On expand: mount immediately (sync during render).
 * On collapse: stay mounted for the animation duration, then unmount via timer.
 */
function useDeferredUnmount(collapsed: boolean): boolean {
  const [unmounted, setUnmounted] = useState(collapsed);

  // Expand: sync setState during render (React-approved pattern for
  // adjusting state based on changed props without an effect).
  if (!collapsed && unmounted) {
    setUnmounted(false);
  }

  // Collapse: delayed unmount via effect.
  // The cleanup cancels the timer if collapsed changes back before firing.
  useEffect(() => {
    if (!collapsed) return;
    const timer = setTimeout(() => setUnmounted(true), COLLAPSE_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);

  return !unmounted;
}

/**
 * Global right-side sidepane container for UserTask.
 * Rendered at the app-body level alongside left-nav and content-container.
 * Unmounts children after collapse animation completes to reduce DOM weight.
 */
export const RightGlobalSidepane: React.FC = () => {
  const [collapsed] = RightPaneCollapsedAtom.use();
  const { width, resizing } = RightPaneSizeAtom.useData();
  const shouldMount = useDeferredUnmount(collapsed);

  if (!shouldMount) return null;

  return (
    <div
      className="shrink-0 flex flex-col overflow-hidden h-full rounded-lg border border-black/7.5 shadow-[0px_2px_6px_rgba(0,0,0,0.05)] transition-[width] duration-250 ease-[ease]"
      style={{
        width: collapsed ? 0 : width,
        visibility: collapsed ? 'hidden' : undefined,
        overflow: collapsed ? 'hidden' : undefined,
        transition: resizing ? 'unset' : undefined,
      }}
    >
    </div>
  );
};
