import { appCacheManager } from '@main/lib/appCache';
import { BrowserWindow } from 'electron';
import { mainToRender as windowMainToRender } from '@shared/ipc/window';

export type WindowRole = 'main' | 'log' | 'screenshot' | 'research';
type CallBackWin = (win: BrowserWindow) => void;

export interface BrowserWindowMeta {
  role: WindowRole;
  /** 主窗口创建时绑定；生命周期内不可变。 */
  profileId?: string;
  tag?: string;
}

// WeakMap：窗口销毁后自动清理，无需手动维护 closed 监听。
const metas = new WeakMap<BrowserWindow, BrowserWindowMeta>();

// 应用级窗口注册表。主窗口以 Profile ID 唯一定位；其他窗口按自身生命周期管理。
const __windows__ = {
  main: new Map<string, BrowserWindow>(),
  log: null as BrowserWindow | null,
  research: null as BrowserWindow | null,
  screenshots: new Set<BrowserWindow>(),
};
function requireMainProfileId(profileId: string | undefined): string {
  if (!profileId) throw new Error('Main window requires a profile ID.');
  return profileId;
}


export function createWindow(
  options: Electron.BrowserWindowConstructorOptions,
  meta: BrowserWindowMeta,
): BrowserWindow {
  if (meta.role === 'main') {
    const profileId = requireMainProfileId(meta.profileId);
    const existing = __windows__.main.get(profileId);
    if (existing && !existing.isDestroyed()) return existing;
    if (existing) __windows__.main.delete(profileId);
  }

  const win = new BrowserWindow(options);
  metas.set(win, meta);

  if (meta.role === 'main') {
    const profileId = requireMainProfileId(meta.profileId);
    __windows__.main.set(profileId, win);
    win.once('closed', () => {
      __windows__.main.delete(profileId);
    });
  } else if (meta.role === 'screenshot') {
    __windows__.screenshots.add(win);
    win.once('closed', () => {
      __windows__.screenshots.delete(win);
    });
  } else {
    const role = meta.role;
    __windows__[role] = win;
    win.once('closed', () => {
      if (__windows__[role] === win) {
        __windows__[role] = null;
      }
    });
  }

  return win;
}

export function getWindowMeta(win: BrowserWindow): BrowserWindowMeta | undefined {
  return metas.get(win);
}

export function eachWindow(
  callback: (win: BrowserWindow, meta: BrowserWindowMeta) => void,
): void {
  const registered = [
    ...__windows__.main.values(),
    __windows__.log,
    __windows__.research,
    ...__windows__.screenshots,
  ];
  for (const win of registered) {
    if (!win) continue;
    const meta = metas.get(win);
    if (meta) callback(win, meta);
  }
}

export function eachWebContent(
  callback: (wc: Electron.WebContents, meta: BrowserWindowMeta) => void,
): void {
  eachWindow((win, meta) => {
    callback(win.webContents, meta);
  });
}

/** @deprecated Profile-scoped paths must call mainWindowForProfile(). */
export function mainWindow(): BrowserWindow | null {
  return focusedMainWindow() ?? __windows__.main.values().next().value ?? null;
}

export function mainWindowForProfile(
  profileId: string,
  call?: CallBackWin,
): BrowserWindow | null {
  const win = __windows__.main.get(profileId);
  if (!win) return null;
  if (win.isDestroyed()) {
    __windows__.main.delete(profileId);
    return null;
  }
  if (call) call(win);
  return win;
}

export function focusedMainWindow(call?: CallBackWin): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  const target = focused && metas.get(focused)?.role === 'main' ? focused : null;
  if (target && call) call(target);
  return target;
}

/** @deprecated Profile-scoped paths must call mainWindowForProfile(). */
export function mainWebContents(): Electron.WebContents | null {
  return mainWindow()?.webContents ?? null;
}


export function logWindow() {
  return __windows__.log;
}

export function researchWindow() {
  return __windows__.research;
}

export function windowByRole(
  role: Exclude<WindowRole, 'main' | 'screenshot'>,
  call?: CallBackWin,
): BrowserWindow | null {
  const target = __windows__[role];
  if (target && !target.isDestroyed()) {
    if (call) call(target);
    return target;
  }
  return null;
}

// 给广播 / fallback 用：选第一个未销毁的已注册窗口（main 优先）。
// screenshot 窗口不参与，因为它是临时浮层。
export function anyVisibleWindow(call?: CallBackWin): BrowserWindow | null {
  const candidates: Array<BrowserWindow | null> = [
    focusedMainWindow(),
    ...__windows__.main.values(),
    __windows__.research,
    __windows__.log,
  ];
  for (const window of candidates) {
    if (window && !window.isDestroyed()) {
      if (call) call(window);
      return window;
    }
  }
  return null;
}

export const zoomLevel = (() => {
  function normalizeWindowZoomLevel(level: number): number {
    const zoomStep = 0.5;
    const zoomMin = -3;
    const zoomMax = 3;
    const rounded = Math.round(level / zoomStep) * zoomStep;
    return Math.min(zoomMax, Math.max(zoomMin, rounded));
  }

  async function get(): Promise<number> {
    await appCacheManager.initialize();
    const zoomLevel = appCacheManager.getConfig().zoomLevel;
    return typeof zoomLevel === 'number' ? normalizeWindowZoomLevel(zoomLevel) : 0;
  }

  function apply(window: BrowserWindow, level: number): number {
    if (window.isDestroyed()) return 0;

    const next = normalizeWindowZoomLevel(level);
    window.webContents.setZoomLevel(next);
    windowMainToRender.bindWebContents(window.webContents).zoomChanged(next);
    return next;
  }

  async function persist(level: number): Promise<void> {
    try {
      await appCacheManager.initialize();
      await appCacheManager.updateConfig({ zoomLevel: level });
    } catch (e) {
      console.error('[Zoom] Failed to persist zoom level:', e);
    }
  }

  async function step(window: BrowserWindow, delta: number): Promise<number> {
    const current = await get();
    const next = normalizeWindowZoomLevel(current + delta);
    apply(window, next);
    void persist(next);
    return next;
  }

  async function reset(window: BrowserWindow): Promise<number> {
    const next = apply(window, 0);
    void persist(next);
    return next;
  }

  return { get, apply, step, reset };
})();

