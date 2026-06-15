import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/mainWindow';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'showWithAgent',
]);
export default invoke;
