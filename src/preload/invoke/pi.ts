import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/pi';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'listAccounts',
  'startLogin',
  'cancelLogin',
  'submitPrompt',
  'setApiKey',
  'logout',
  'listModelsForProvider',
  'getModelInfo',
]);

export default invoke;
