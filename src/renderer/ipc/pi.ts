import { renderToMain, mainToRender } from '@shared/ipc/pi';

export const piApi = renderToMain.bindRender(window.electronAPI.pi.invoke);
export const piEvents = mainToRender.bindRender(
  window.electronAPI.pi.on,
  window.electronAPI.pi.off,
);
