import { ipcRenderer } from 'electron';
import { subAgentRenderToMain } from '@shared/ipc/subAgent';

export const invokeSubAgent = subAgentRenderToMain.provideInvokeForPreload(ipcRenderer, [
  'getAll',
  'add',
  'update',
  'delete',
  'importFromFile',
  'exportAsClaudeCode',
  'openInExplorer',
  'syncFromDisk',
]);
