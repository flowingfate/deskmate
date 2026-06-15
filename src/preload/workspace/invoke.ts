import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/workspace';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'selectFolder',
  'getFileTree',
  'clearFileTreeCache',
  'getDirectoryChildren',
  'copyPath',
  'copyPaths',
  'startWatch',
  'stopWatch',
  'getWatcherStats',
  'searchFiles',
  'openPath',
  'showInFolder',
]);

export default invoke;
