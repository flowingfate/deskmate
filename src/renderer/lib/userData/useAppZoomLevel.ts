import { useEffect, useState } from 'react';
import { appDataManager } from './appDataManager';
import { windowApi, windowEvents } from '@/ipc/window';
import { log } from '@/log';
const logger = log.child({ mod: 'UseAppZoomLevel' });

export function useAppZoomLevel(): number {
  const [zoomLevel, setZoomLevel] = useState<number>(
    () => appDataManager.getConfig().zoomLevel ?? 0,
  );

  useEffect(() => {
    const updateZoomLevel = (config: ReturnType<typeof appDataManager.getConfig>) => {
      setZoomLevel(config.zoomLevel ?? 0);
    };

    const syncWithWindowZoom = async () => {
      try {
        const actualZoomLevel = await windowApi.getZoomLevel();
        setZoomLevel(actualZoomLevel);
      } catch (error) {
        logger.error({ msg: "Failed to read actual window zoom level:", err: error });
      }
    };

    updateZoomLevel(appDataManager.getConfig());
    void syncWithWindowZoom();

    const unsub = appDataManager.subscribe(updateZoomLevel);
    const cleanupZoomChanged = windowEvents.zoomChanged((_event, level) => {
      setZoomLevel(level);
    });

    return () => {
      unsub();
      cleanupZoomChanged();
    };
  }, []);

  return zoomLevel;
}