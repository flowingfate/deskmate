import { mainToRender } from '@shared/ipc/navigate';

export const navigateEvents = mainToRender.bindRender(
  window.electronAPI.navigate.on,
  window.electronAPI.navigate.off,
);
