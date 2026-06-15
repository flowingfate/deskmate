import { subAgentRenderToMain, subAgentMainToRender } from '@shared/ipc/subAgent';

export const subAgentApi = subAgentRenderToMain.bindRender(window.electronAPI.subAgent.invoke);
export const subAgentEvents = subAgentMainToRender.bindRender(
  window.electronAPI.subAgent.on,
  window.electronAPI.subAgent.off,
);
