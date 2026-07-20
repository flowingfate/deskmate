import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/internalUrls';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'resolveToPath',
]);

export default invoke;
