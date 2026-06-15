import { ipcMain } from 'electron';
import { renderToMain as quickStartImageCacheRenderToMain } from '@shared/ipc/quickStartImageCache';
import { quickStartImageCacheManager } from '../../lib/cache/quickStartImageCacheManager';

export default function handleQuickStartImageCacheIPC() {
  const handle = quickStartImageCacheRenderToMain.bindMain(ipcMain);

  // Get or cache image (download and cache if not present)
  handle.getOrCache(async (_event, agentName, imageUrl) => {
    try {
      const result = await quickStartImageCacheManager.getOrCacheImage(agentName, imageUrl);
      return {
        success: true as const,
        data: result // May be file:// URL or null
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Clear image cache for specified Agent
  handle.clearAgent(async (_event, agentName) => {
    try {
      quickStartImageCacheManager.clearAgentCache(agentName);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Clear all image cache
  handle.clearAll(async () => {
    try {
      quickStartImageCacheManager.clearAllCache();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
}
