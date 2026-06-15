import { renderToMain, mainToRender } from '@shared/ipc/persist';

export const persistApi = renderToMain.bindRender(window.electronAPI.persist.invoke);
export const persistEvents = mainToRender.bindRender(
  window.electronAPI.persist.on,
  window.electronAPI.persist.off,
);
