import { BrowserWindow } from 'electron';

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

export function createWindow(
  options: Electron.BrowserWindowConstructorOptions,
  meta: BrowserWindowMeta,
): BrowserWindow {
  const win = new BrowserWindow(options);
  metas.set(win, meta);

  if (meta.role === 'main') {
    if (!meta.profileId) throw new Error('Main window requires a profile ID.');
    const id = meta.profileId;
    __windows__.main.set(id, win);
    win.once('closed', () => {
      __windows__.main.delete(id);
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
