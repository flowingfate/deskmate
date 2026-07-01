import { renderToMain, mainToRender } from '@shared/ipc/research';

export const researchApi = renderToMain.bindRender(
  window.electronAPI.research.invoke,
);

export const researchEvents = mainToRender.bindRender(
  window.electronAPI.research.on,
  window.electronAPI.research.off,
);
