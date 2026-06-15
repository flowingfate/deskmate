import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/quickStartImageCache';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'getOrCache',
  'clearAgent',
  'clearAll',
]);
export default invoke;
