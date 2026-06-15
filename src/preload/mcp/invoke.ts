import { ipcRenderer } from 'electron';
import { mcpRenderToMain, mcpAuthRenderToMain } from '@shared/ipc/mcp';

export const invokeMcp = mcpRenderToMain.provideInvokeForPreload(ipcRenderer, [
  'getServerStatus',
  'resetOAuth',
  'addServer',
  'updateServer',
  'deleteServer',
  'connectServer',
  'reconnectServer',
  'disconnectServer',
]);

export const invokeMcpAuth = mcpAuthRenderToMain.provideInvokeForPreload(ipcRenderer, [
  'respondConsent',
  'respondClientId',
]);
