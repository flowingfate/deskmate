import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/chatSession';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'downloadChatSession',
  'downloadScheduleRun',
  'getFilePath',
  'getScheduleRunFilePath',
]);

export default invoke;
