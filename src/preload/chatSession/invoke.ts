import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/chatSession';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'downloadChatSession',
  'getFilePath',
]);

export default invoke;
