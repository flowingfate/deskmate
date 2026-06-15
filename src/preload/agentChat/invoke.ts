import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/agentChat';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'streamMessage',
  'retryChat',
  'editUserMessage',
  'canEditUserMessage',
  'cancelChatSession',
  'removeAgentInstance',
  'forkChatSession',
  'importChatSession',
  'loadChatSessionSnapshot',
  'markSessionRead',
  'loadJobRunSnapshot',
  'markJobRunRead',
]);

export default invoke;
