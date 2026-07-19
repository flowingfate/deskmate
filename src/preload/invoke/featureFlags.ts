import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/featureFlags';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'getAllFlags',
]);

export default invoke;
