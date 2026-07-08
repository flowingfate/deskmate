import { ipcMain, dialog } from 'electron';
import { ScreenshotManager } from './ScreenshotManager';
import { renderToMain } from '@shared/ipc/screenshot';
import type { ScreenshotSettings } from '@shared/ipc/screenshot';
import { mainToRender as navigateMainToRender } from '@shared/ipc/navigate';
import { log } from '@main/log';
import { registerScreenshotShortcut } from './screenshotShortcut';
import { isFeatureEnabled } from '../featureFlags';
import { appCacheManager } from "../appCache";
import { mainWindow } from '@main/startup/wins';

const logger = log;

let isRegistered = false;

export interface ScreenshotIPCOptions {
  // No options currently; kept as an empty interface for future extension.
}

async function getSettings(): Promise<ScreenshotSettings> {
  const settings = appCacheManager.getScreenshotSettings();
  // When the feature flag is disabled, force enabled=false
  if (!isFeatureEnabled('deskmateFeatureScreenshot')) {
    return { ...settings, enabled: false };
  }
  return settings;
}

export const registerScreenshotIPC = (options: ScreenshotIPCOptions): void => {
  if (isRegistered) return;

  const screenshotManager = ScreenshotManager.getInstance();

  const handle = renderToMain.bindMain(ipcMain);

  handle.capture(async (_event, callback = true) => {
    return await screenshotManager.capture(callback);
  });

  handle.selectionStart(async (_event, displayId) => {
    logger.info({ msg: '[ScreenshotIPC] selectionStart invoked' });
    screenshotManager.onSelectionStart(displayId);
  });

  handle.saveToFile(async (_event, displayId, rect, imageData) => {
    const savePath = (await getSettings())?.savePath || undefined;
    return await screenshotManager.saveToFile(displayId, rect, imageData, savePath);
  });

  handle.copyToClipboard(async (_event, displayId, rect) => {
    return await screenshotManager.copyToClipboard(displayId, rect);
  });

  handle.sendToMain((_event, displayId, rect, imageData) => {
    return screenshotManager.sendToMain(displayId, rect, imageData);
  });

  handle.close(async () => {
    screenshotManager.cleanup();
  });

  handle.getInitData(async (_event, displayId) => {
    return screenshotManager.getInitData(displayId);
  });

  handle.getSettings(async () => {
    const settings = await getSettings();
    return { success: true, data: settings };
  });

  handle.updateSettings(async (_event, newSettings) => {
    const success = await appCacheManager.updateScreenshotSettings(newSettings);
    if (!success) return { success: false, error: 'Failed to update screenshot settings' };
    registerScreenshotShortcut(options);
    return { success: true };
  });

  handle.selectSavePath(async () => {
    const win = mainWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
          title: 'Select Screenshot Save Directory',
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
          title: 'Select Screenshot Save Directory',
        });
    if (Array.isArray(result)) {
      return { success: true, data: result.length === 0 ? null : result[0] };
    }
    const dialogResult = result as any;
    if (dialogResult.canceled || !dialogResult.filePaths?.length) {
      return { success: true, data: null };
    }
    return { success: true, data: dialogResult.filePaths[0] };
  });

  handle.rejectFre(async () => {
    const success = await appCacheManager.updateScreenshotSettings({ freRejected: true });
    if (!success) return { success: false, error: 'Failed to update settings' };
    return { success: true };
  });

  handle.navigateToSettings(async () => {
    screenshotManager.cleanup();
    // Navigate main window to screenshot settings
    const win = mainWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
      navigateMainToRender.bindWebContents(win.webContents).to({ route: '/settings/screenshot' });
    }
    return { success: true };
  });

  isRegistered = true;
  logger.info({ msg: '[ScreenshotIPC] IPC handlers registered' });
};
