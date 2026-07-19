import { app, ipcMain } from 'electron';
import { renderToMain as updateRenderToMain } from '@shared/ipc/update';
import  { updater, UpdateManager } from '../../lib/autoUpdate';
import { ProfileRegistry } from '../../profileRegistry';
import { log } from '@main/log';
import { APP_VERSION } from '@shared/constants/branding';

const logger = log;

type UseUpdateManagerResult<T> =
  { type: 'init-failed'; error: any } |
  { type: 'call-failed'; error: any } |
  { type: 'success', error: null, data: T };

export default function handleUpdateIPC() {
  async function useUpdateManager<T>(call: (manager: UpdateManager) => Promise<T>): Promise<UseUpdateManagerResult<T>> {
    try {
      const manager = updater.setup();
      try {
        const data = await call(manager);
        return { type: 'success', error: null, data };
      } catch (error) {
        return { type: 'call-failed', error };
      }
    } catch (error) {
      return { type: 'init-failed', error };
    }
  }

  // Update related IPC handlers
  const handle = updateRenderToMain.bindMain(ipcMain);
  handle.checkForUpdates(async (_event, silent) => {
    try {
      const result = await useUpdateManager(m => m.checkForUpdates(silent));
      // 🔥 Fix: try to initialize if update manager is not initialized
      if (result.type === 'init-failed') {
        return { success: false, error: 'Failed to initialize update manager: ' + (result.error instanceof Error ? result.error.message : 'Unknown error') };
      }
      if (result.type === 'call-failed') throw result.error;



      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.downloadUpdate(async (_event, downloadUrl) => {
    const { type, error } = await useUpdateManager(m => m.downloadUpdate(downloadUrl));
    // 🔥 Fix: try to initialize if update manager is not initialized
    if (type === 'init-failed') {
      return { success: false, error: 'Failed to initialize update manager: ' + (error instanceof Error ? error.message : 'Unknown error') };
    }
    if (type === 'call-failed') {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
    return { success: true };
  });

  handle.quitAndInstall(async (_event, filePath) => {
    const registry = ProfileRegistry;
    try {
      logger.info({ msg: 'scheduler.lifecycle.updater-handoff', mod: 'update:quitAndInstall', stage: 'before-shutdown', filePath, schedulerStates: registry.getSchedulerDiagnostics() });
      await registry.shutdownAll();
      logger.info({ msg: 'scheduler.lifecycle.updater-handoff', mod: 'update:quitAndInstall', stage: 'after-shutdown', filePath, schedulerStates: registry.getSchedulerDiagnostics() });
    } catch (schedulerError) {
      logger.warn({ msg: 'scheduler.lifecycle.updater-handoff', mod: 'update:quitAndInstall', stage: 'shutdown-failed', filePath, err: schedulerError });
    }

    console.log('[MAIN] 🚀 update:quitAndInstall IPC handler called!', {
      timestamp: new Date().toISOString(),
      filePath,
    });

    const { type, error } = await useUpdateManager(async (m) => {
      console.log('[MAIN] 📞 Calling updateManager.quitAndInstall...');
      m.quitAndInstall(filePath);
      console.log('[MAIN] ✅ updateManager.quitAndInstall completed');
    });
    // 🔥 Fix: try to initialize if update manager is not initialized
    if (type === 'init-failed') {
      console.error('[MAIN] ❌ Failed to initialize update manager:', error);
      throw error;
    }
    if (type === 'call-failed') {
      console.error('[MAIN] ❌ update:quitAndInstall error:', error);
      throw error;
    }
  });

  handle.getVersion(() => {
    return APP_VERSION;
  });

  handle.skipVersion(async (_event, version) => {
    const { type, error } = await useUpdateManager(async (m) => m.skipVersion(version));
    // 🔥 Fix: try to initialize if update manager is not initialized
    if (type === 'init-failed') {
      return { success: false, error: 'Failed to initialize update manager: ' + (error instanceof Error ? error.message : 'Unknown error') };
    }
    if (type === 'call-failed') {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
    return { success: true };
  });

  handle.getPreferences(async () => {
    const result = await useUpdateManager(async (m) => m.getPreferences());
    if (result.type === 'success') {
      return { success: true, data: result.data };
    }
    const { type, error } = result;
    // 🔥 Fix: try to initialize if update manager is not initialized
    if (type === 'init-failed') {
      return { success: false, error: 'Failed to initialize update manager: ' + (error instanceof Error ? error.message : 'Unknown error') };
    }
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  });

  handle.updatePreferences(async (_event, preferences) => {
    const { type, error } = await useUpdateManager(async (m) => m.updatePreferences(preferences));
    // 🔥 Fix: try to initialize if update manager is not initialized
    if (type === 'init-failed') {
      return { success: false, error: 'Failed to initialize update manager: ' + (error instanceof Error ? error.message : 'Unknown error') };
    }
    if (type === 'call-failed') {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
    return { success: true };
  });
}
