import { mainToRender } from '@shared/ipc/notification';

export const notificationEvents = mainToRender.bindRender(
  window.electronAPI.notification.on,
  window.electronAPI.notification.off,
);
