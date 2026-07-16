import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/subagentRun';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'cancelRun',
  'getRunMessages',
  'getRunData',
]);

export default invoke;
