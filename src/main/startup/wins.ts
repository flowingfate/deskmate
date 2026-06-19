import { BrowserWindow } from 'electron';

export type WindowRole = 'main' | 'log' | 'screenshot';

export interface BrowserWindowMeta {
  role: WindowRole;
  tag?: string;
}

// WeakMap：窗口销毁后自动清理，无需手动维护 closed 监听。
const metas = new WeakMap<BrowserWindow, BrowserWindowMeta>();

const __windows__ = {
  main: null as BrowserWindow | null,
  log: null as BrowserWindow | null,
};
const __screenshots__ = new Set<BrowserWindow>();

export function createWindow(
  options: Electron.BrowserWindowConstructorOptions,
  meta: BrowserWindowMeta,
): BrowserWindow {
  const win = new BrowserWindow(options);
  metas.set(win, meta);

  if (meta.role === 'screenshot') {
    __screenshots__.add(win);
    win.once('closed', () => {
      __screenshots__.delete(win);
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
  for (const win of BrowserWindow.getAllWindows()) {
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

export function mainWindow() {
  return __windows__.main;
}

export function mainWebContents() {
  return __windows__.main?.webContents;
}


export function logWindow() {
  return __windows__.log;
}

export function windowByRole(role: Exclude<WindowRole, 'screenshot'>): BrowserWindow | null {
  return __windows__[role];
}

// 给广播 / fallback 用：选第一个未销毁的已注册窗口（main 优先）。
// screenshot 窗口不参与，因为它是临时浮层。
export function anyVisibleWindow(): BrowserWindow | null {
  const candidates: Array<BrowserWindow | null> = [
    __windows__.main,
    __windows__.log,
  ];
  for (const w of candidates) {
    if (w && !w.isDestroyed()) return w;
  }
  return null;
}
