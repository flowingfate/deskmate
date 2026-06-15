import { renderToMain, mainToRender } from '@shared/ipc/update';

export const updateApi = renderToMain.bindRender(window.electronAPI.update.invoke);
export const updateEvents = mainToRender.bindRender(
  window.electronAPI.update.on,
  window.electronAPI.update.off,
);
