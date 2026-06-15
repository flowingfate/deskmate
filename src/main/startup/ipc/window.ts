import { ipcMain, Menu } from 'electron';

import { renderToMain } from '@shared/ipc/window';
import type { Context } from './shared';
import { mainWindow } from '@main/startup/wins';

export default function(ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  handle.minimize(() => mainWindow()?.minimize());
  handle.maximize(() => mainWindow()?.maximize());
  handle.unmaximize(() => mainWindow()?.unmaximize());
  handle.close(() => mainWindow()?.close());
  handle.isMaximized(() => mainWindow()?.isMaximized() || false);
  handle.isFullScreen(() => mainWindow()?.isFullScreen() || false);

  const syncWindowZoomWithPersistedState = async () => {
    const zoomLevel = await ctx.getPersistedWindowZoomLevel();
    return ctx.applyWindowZoomLevel(zoomLevel);
  };

  handle.zoomIn(async () => {
    return ctx.stepWindowZoomLevel(0.5);
  });
  handle.zoomOut(async () => {
    return ctx.stepWindowZoomLevel(-0.5);
  });
  handle.resetZoom(async () => {
    return ctx.resetWindowZoomLevel();
  });
  handle.getZoomLevel(async () => {
    return syncWindowZoomWithPersistedState();
  });

  handle.showAppMenu((_event, x, y) => {
    const template = ctx.getMenuTemplate();
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow() || undefined });
    return true;
  });

  handle.setAlwaysOnTop((_event, flag) => {
    const win = mainWindow();
    if (win) {
      win.setAlwaysOnTop(flag, 'floating');
      return true;
    }
    return false;
  });

  handle.isAlwaysOnTop(() => {
    return mainWindow()?.isAlwaysOnTop() || false;
  });

  handle.setSize((_event, width, height) => {
    const win = mainWindow();
    if (win) {
      win.setSize(width, height);
      win.center();
      return true;
    }
    return false;
  });

  handle.getSize(() => {
    const win = mainWindow();
    if (win) {
      const [width, height] = win.getSize();
      return { width, height };
    }
    return { width: 1200, height: 800 };
  });

  handle.setMinSize((_event, width, height) => {
    const win = mainWindow();
    if (win) {
      win.setMinimumSize(width, height);
      return true;
    }
    return false;
  });

  handle.setMaxSize((_event, width, height) => {
    const win = mainWindow();
    if (win) {
      win.setMaximumSize(width, height);
      return true;
    }
    return false;
  });

  handle.getMinSize(() => {
    const win = mainWindow();
    if (win) {
      const [width, height] = win.getMinimumSize();
      return { width, height };
    }
    return { width: 800, height: 600 };
  });

  handle.getMaxSize(() => {
    const win = mainWindow();
    if (win) {
      const [width, height] = win.getMaximumSize();
      return { width, height };
    }
    return { width: 0, height: 0 };
  });
}
