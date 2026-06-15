import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/attachment';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'attachFromPath',
  'attachFromBytes',
]);

export default invoke;
