import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/fs';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'deletePaths',
  'exists',
  'listDir',
  'access',
  'readFile',
  'writeFile',
  'stat',
  'expandPath',
  'selectFile',
  'getFileMetadata',
  'downloadFile',
  'selectFiles',
]);

export default invoke;
