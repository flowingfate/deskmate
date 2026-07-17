import { BrowserWindow, ipcMain, Menu } from 'electron';

import { renderToMain } from '@shared/ipc/window';
import type { Context } from './shared';

export default function(ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);
  handle.openProfile(async (_event, profileId) => {
    await ctx.openProfileMainWindow(profileId);
  });

  const windowForSender = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window && !window.isDestroyed() ? window : null;
  };

  handle.minimize((event) => windowForSender(event)?.minimize());
  handle.maximize((event) => windowForSender(event)?.maximize());
  handle.unmaximize((event) => windowForSender(event)?.unmaximize());
  handle.close((event) => windowForSender(event)?.close());
  handle.isMaximized((event) => windowForSender(event)?.isMaximized() || false);
  handle.isFullScreen((event) => windowForSender(event)?.isFullScreen() || false);

  const syncWindowZoomWithPersistedState = async (event: Electron.IpcMainInvokeEvent) => {
    const window = windowForSender(event);
    if (!window) return 0;
    const zoomLevel = await ctx.getPersistedWindowZoomLevel();
    return ctx.applyWindowZoomLevel(window, zoomLevel);
  };

  handle.zoomIn(async (event) => {
    const window = windowForSender(event);
    return window ? ctx.stepWindowZoomLevel(window, 0.5) : 0;
  });
  handle.zoomOut(async (event) => {
    const window = windowForSender(event);
    return window ? ctx.stepWindowZoomLevel(window, -0.5) : 0;
  });
  handle.resetZoom(async (event) => {
    const window = windowForSender(event);
    return window ? ctx.resetWindowZoomLevel(window) : 0;
  });
  handle.getZoomLevel(async (event) => {
    return syncWindowZoomWithPersistedState(event);
  });

  handle.showAppMenu((event) => {
    const menu = Menu.buildFromTemplate(ctx.getMenuTemplate());
    menu.popup({ window: windowForSender(event) || undefined });
    return true;
  });

  handle.setAlwaysOnTop((event, flag) => {
    const window = windowForSender(event);
    if (!window) return false;
    window.setAlwaysOnTop(flag, 'floating');
    return true;
  });

  handle.isAlwaysOnTop((event) => windowForSender(event)?.isAlwaysOnTop() || false);

  handle.setSize((event, width, height) => {
    const window = windowForSender(event);
    if (!window) return false;
    window.setSize(width, height);
    window.center();
    return true;
  });

  handle.getSize((event) => {
    const window = windowForSender(event);
    if (!window) return { width: 1200, height: 800 };
    const [width, height] = window.getSize();
    return { width, height };
  });

  handle.setMinSize((event, width, height) => {
    const window = windowForSender(event);
    if (!window) return false;
    window.setMinimumSize(width, height);
    return true;
  });

  handle.setMaxSize((event, width, height) => {
    const window = windowForSender(event);
    if (!window) return false;
    window.setMaximumSize(width, height);
    return true;
  });

  handle.getMinSize((event) => {
    const window = windowForSender(event);
    if (!window) return { width: 800, height: 600 };
    const [width, height] = window.getMinimumSize();
    return { width, height };
  });

  handle.getMaxSize((event) => {
    const window = windowForSender(event);
    if (!window) return { width: 0, height: 0 };
    const [width, height] = window.getMaximumSize();
    return { width, height };
  });
}
