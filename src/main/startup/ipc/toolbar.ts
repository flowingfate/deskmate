import { ipcMain } from 'electron';

import { Profiles } from '../../persist/profiles';
import type { Context } from './shared';
import type { ToolBarSettings } from '@shared/types/profileTypes';
import { renderToMain } from '@shared/ipc/toolbar';
import { toolBarWindow } from '@main/startup/wins';

// 与老 DEFAULT_TOOLBAR_SETTINGS 一致；partial 合并时填齐 required 字段。
const DEFAULT_TOOLBAR_SETTINGS: ToolBarSettings = {
  enabled: false,
  alwaysOnTop: false,
  autoHide: true,
  shortcut: 'CommandOrControl+Shift+Space',
  visibleAgents: [],
};

export default function(ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  // ToolBar window control
  handle.show(() => {
    ctx.showToolBar();
    return { success: true };
  });

  handle.hide(() => {
    ctx.hideToolBar();
    return { success: true };
  });

  handle.toggle(async () => {
    await ctx.toggleToolBar();
    return { success: true };
  });

  handle.isVisible(() => {
    const win = toolBarWindow();
    return { success: true, data: !!(win && !win.isDestroyed() && win.isVisible()) };
  });

  handle.setAlwaysOnTop((_event, flag) => {
    const win = toolBarWindow();
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(flag, 'floating');
      return { success: true };
    }
    return { success: false, error: 'Tool Bar window not available' };
  });

  handle.isAlwaysOnTop(() => {
    const win = toolBarWindow();
    if (win && !win.isDestroyed()) {
      return { success: true, data: win.isAlwaysOnTop() };
    }
    return { success: false, error: 'Tool Bar window not available' };
  });

  handle.getPosition(() => {
    const win = toolBarWindow();
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      return { success: true, data: { x, y } };
    }
    return { success: false, error: 'Tool Bar window not available' };
  });

  handle.setPosition((_event, x, y) => {
    const win = toolBarWindow();
    if (win && !win.isDestroyed()) {
      win.setPosition(x, y);
      return { success: true };
    }
    return { success: false, error: 'Tool Bar window not available' };
  });

  // ToolBar configuration management
  handle.getSettings(async () => {
    try {
      const profile = await Profiles.get().active();
      return { success: true, data: profile.settings.toolBar };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.updateSettings(async (_event, settings) => {
    try {
      const profile = await Profiles.get().active();
      // partial 合并语义：当前 settings 之上覆盖传入字段（缺字段用 default 补齐保证 required 满足）
      const merged: ToolBarSettings = { ...DEFAULT_TOOLBAR_SETTINGS, ...(profile.settings.toolBar ?? {}), ...settings };
      await profile.patchSettings({ toolBar: merged });
      // Apply new settings to current ToolBar window
      ctx.applyToolBarSettings(settings);
      // Force reload to ensure visible agents update immediately
      const win = toolBarWindow();
      if (win && !win.isDestroyed()) {
        win.reload();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.updateShortcut(async (_event, shortcut) => {
    try {
      // Unregister current global shortcuts
      ctx.unregisterGlobalShortcuts();

      try {
        const profile = await Profiles.get().active();
        const merged: ToolBarSettings = { ...DEFAULT_TOOLBAR_SETTINGS, ...(profile.settings.toolBar ?? {}), shortcut };
        await profile.patchSettings({ toolBar: merged });
      } catch (err) {
        // If settings update failed, re-register old shortcuts
        ctx.registerGlobalShortcuts();
        return { success: false, error: err instanceof Error ? err.message : 'Failed to save shortcut setting' };
      }

      // Register new global shortcut
      ctx.registerGlobalShortcuts();

      return { success: true };
    } catch (error) {
      // If anything fails, re-register old shortcuts
      ctx.registerGlobalShortcuts();
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.resetPosition(async () => {
    try {
      const win = toolBarWindow();
      if (win && !win.isDestroyed()) {
        // Recalculate position based on current mouse location
        const position = ctx.calculateToolBarPosition();
        win.setPosition(position.x, position.y);
        return { success: true, data: position };
      }
      return { success: false, error: 'ToolBar window not available' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
