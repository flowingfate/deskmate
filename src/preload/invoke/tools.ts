import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/tools';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'execute',
  'getAll',
  'has',
]);

export default invoke;
