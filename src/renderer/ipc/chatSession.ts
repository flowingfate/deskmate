import { renderToMain, mainToRender } from '@shared/ipc/chatSession';

export const chatSessionApi = renderToMain.bindRender(window.electronAPI.chatSession.invoke);
export const chatSessionEvents = mainToRender.bindRender(
  window.electronAPI.chatSession.on,
  window.electronAPI.chatSession.off,
);
