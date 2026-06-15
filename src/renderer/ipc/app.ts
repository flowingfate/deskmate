import { renderToMain, mainToRender } from '@shared/ipc/app';

export const appApi = renderToMain.bindRender(
  window.electronAPI.app.invoke
);

export const appEvents = mainToRender.bindRender(
  window.electronAPI.app.on,
  window.electronAPI.app.off,
);
