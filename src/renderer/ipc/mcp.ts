import {
  mcpRenderToMain,
  mcpMainToRender,
  mcpAuthRenderToMain,
  mcpAuthMainToRender,
} from '@shared/ipc/mcp';

export const mcpApi = mcpRenderToMain.bindRender(window.electronAPI.mcp.invoke);
export const mcpEvents = mcpMainToRender.bindRender(
  window.electronAPI.mcp.on,
  window.electronAPI.mcp.off,
);


export const mcpAuthApi = mcpAuthRenderToMain.bindRender(window.electronAPI.mcpAuth.invoke);
export const mcpAuthEvents = mcpAuthMainToRender.bindRender(
  window.electronAPI.mcpAuth.on,
  window.electronAPI.mcpAuth.off,
);
