import { useEffect } from 'react';
import { windowApi } from '@/ipc/window';

const WindowZoomHotkeys: React.FC = () => {
  useEffect(() => {
    const platform = window.electronAPI?.platform;
    if (!platform) return;

    const isMac = platform === 'darwin';

    const handleKeyDown = (event: KeyboardEvent) => {
      const hasPrimaryModifier = isMac ? event.metaKey : event.ctrlKey;
      const hasSecondaryModifier = isMac ? event.ctrlKey : event.metaKey;

      if (!hasPrimaryModifier || hasSecondaryModifier || event.altKey) {
        return;
      }

      const key = event.key;
      const code = event.code;

      if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
        event.preventDefault();
        void windowApi.resetZoom();
        return;
      }

      if (key === '-' || code === 'Minus' || code === 'NumpadSubtract') {
        event.preventDefault();
        void windowApi.zoomOut();
        return;
      }

      if (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd') {
        event.preventDefault();
        void windowApi.zoomIn();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
};

export default WindowZoomHotkeys;
