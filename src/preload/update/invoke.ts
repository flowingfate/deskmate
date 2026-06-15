import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/update';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'checkForUpdates',
  'downloadUpdate',
  'quitAndInstall',
  'getVersion',
  'skipVersion',
  'getPreferences',
  'updatePreferences',
]);
export default invoke;
