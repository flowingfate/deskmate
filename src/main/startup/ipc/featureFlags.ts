import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/featureFlags';
import { featureFlagManager } from '../../lib/featureFlags';

export default function() {
  const handle = renderToMain.bindMain(ipcMain);

  // Get values of all feature flags
  handle.getAllFlags(async () => {
    try {
      const flags = featureFlagManager.getAllFlagsValues();
      return { success: true, data: flags };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
