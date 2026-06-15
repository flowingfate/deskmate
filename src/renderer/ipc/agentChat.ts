import { renderToMain, mainToRender } from '@shared/ipc/agentChat';

export const agentChatApi = renderToMain.bindRender(window.electronAPI.agentChat.invoke);
export const agentChatEvents = mainToRender.bindRender(
  window.electronAPI.agentChat.on,
  window.electronAPI.agentChat.off,
);
