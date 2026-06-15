import { atom } from '@/atom';
import { appDataManager } from '@/lib/userData/appDataManager';
import { handleDrag } from '@/lib/utils/drag';

// ── Right pane size ─────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;

interface RightPaneSizeState {
  width: number;
  resizing?: boolean;
}

const defaultRightPaneSizeState: RightPaneSizeState = {
  width: DEFAULT_WIDTH,
};

export const RightPaneSizeAtom = atom(defaultRightPaneSizeState, (get, set) => {
  appDataManager.subscribe((config) => {
    const width = (config).rightSidebarWidth;
    if (width !== undefined) set({ width });
  });

  function startResize(event: React.MouseEvent | MouseEvent) {
    const { width } = get();
    handleDrag(event, {
      onMove({ offset }) {
        // Drag LEFT to grow right panel (invert x-delta)
        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width - offset.x));
        set({ width: next, resizing: true });
      },
      onEnd({ offset }) {
        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width - offset.x));
        set({ width: next, resizing: false });
        if (next !== width) {
          appDataManager.updateConfig({ rightSidebarWidth: next });
        }
      },
    });
  }

  return { startResize };
});

// ── Right pane collapsed ────────────────────────────────────────────────────

export const RightPaneCollapsedAtom = atom(true, (get, set) => {
  appDataManager.subscribe((config) => {
    const collapsed = (config).rightSidebarCollapsed;
    if (collapsed !== undefined) set(collapsed);
  });

  function toggle() {
    const next = !get();
    set(next);
    appDataManager.updateConfig({ rightSidebarCollapsed: next });
  }

  function change(next: boolean) {
    if (next === get()) return;
    set(next);
    appDataManager.updateConfig({ rightSidebarCollapsed: next });
  }

  return { toggle, change };
});
