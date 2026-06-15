import { app, ipcMain } from 'electron';

import { crashCaptureManager } from '../../lib/crash/CrashCaptureManager';
import { getAppCacheManager } from '../lazy';
import { renderToMain } from '@shared/ipc/app';

import type { Context } from './shared';
import { getOrCreateInstallationDeviceId } from "../../lib/utilities/idFactory";
import { getAppDataPath } from "@main/persist/lib/path";

export default function(ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  handle.getVersion(() => app.getVersion());
  handle.getName(() => app.getName());
  handle.isDev(() => ctx.isDev);

  handle.isReady(() => ({
    success: true,
    data: ctx.isAgentChatReady,
  }));

  handle.getPlatformInfo(() => {
    const platform = process.platform;
    const arch = process.arch;
    const isWindowsArm = platform === 'win32' && arch === 'arm64';
    return { platform, arch, isWindowsArm };
  });

  handle.getUserDataPath(() => getAppDataPath());

  handle.getInstallationDeviceId(async () => getOrCreateInstallationDeviceId());

  handle.getCrashCaptureStatus(() => crashCaptureManager.getStatus());

  handle.recordCrashBreadcrumb((_event, message, metadata) => {
    crashCaptureManager.recordRendererBreadcrumb(message, metadata);
  });

  handle.reportRendererError((_event, report) => {
    crashCaptureManager.reportRendererError(report);
  });

  handle.getAppConfig(async () => {
    try {
      const manager = await getAppCacheManager();
      return { success: true as const, data: manager.getConfig() };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.updateAppConfig(async (_event, updates) => {
    try {
      const manager = await getAppCacheManager();
      await manager.updateConfig(updates);
      return { success: true as const };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
