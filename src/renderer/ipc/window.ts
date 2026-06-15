import { renderToMain, mainToRender } from '@shared/ipc/window';

export const windowApi = renderToMain.bindRender(
  window.electronAPI.window.invoke
);

export const windowEvents = mainToRender.bindRender(
  window.electronAPI.window.on,
  window.electronAPI.window.off,
);
