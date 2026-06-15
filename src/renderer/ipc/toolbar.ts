import { renderToMain, mainToRender } from '@shared/ipc/toolbar';

export const toolbarApi = renderToMain.bindRender(window.electronAPI.toolbar.invoke);
export const toolbarEvents = mainToRender.bindRender(
  window.electronAPI.toolbar.on,
  window.electronAPI.toolbar.off,
);
