import { app, ipcMain, BrowserWindow } from 'electron';

import { appCacheManager } from '../../lib/appCache';
import { renderToMain } from '@shared/ipc/app';
import { crashRecorder } from '@main/lib/crash-recorder';
import { APP_VERSION } from '@shared/constants/branding';

import { getOrCreateInstallationDeviceId } from "../../lib/utilities/idFactory";
import { getAppDataPath } from "@main/persist/lib/path";
import { IS_DEV } from '../context';

export default function() {
  const handle = renderToMain.bindMain(ipcMain);

  handle.getVersion(() => APP_VERSION);
  handle.getName(() => app.getName());
  handle.isDev(() => IS_DEV);

  handle.isReady((event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return {
      success: true,
      data: Boolean(window && !window.isDestroyed()),
    };
  });

  handle.getPlatformInfo(() => {
    const platform = process.platform;
    const arch = process.arch;
    const isWindowsArm = platform === 'win32' && arch === 'arm64';
    return { platform, arch, isWindowsArm };
  });

  handle.getUserDataPath(() => getAppDataPath());

  handle.getInstallationDeviceId(async () => getOrCreateInstallationDeviceId());



  handle.listCrashIncidentsForExport(() => crashRecorder.listIncidents({ limit: 20 }).map((incident) => ({
    incidentId: incident.incidentId,
    kind: incident.kind,
    severity: incident.severity,
    summary: incident.summary,
    firstEventAt: incident.firstEventAt,
    artifactCount: incident.artifactCount,
    artifactBytes: incident.artifactBytes,
  })));

  handle.exportCrashIncident((_event, incidentId, options) => crashRecorder.exportIncident(incidentId, options));

  handle.getAppConfig(async () => {
    try {
      await appCacheManager.initialize();
      return { success: true as const, data: appCacheManager.getConfig() };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.updateAppConfig(async (_event, updates) => {
    try {
      await appCacheManager.initialize();
      await appCacheManager.updateConfig(updates);
      return { success: true as const };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
