import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/runtime';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'setMode',
  'installComponent',
  'checkStatus',
  'checkSystemStatus',
  'listPythonVersions',
  'listPythonVersionsFast',
  'installPythonVersion',
  'uninstallPythonVersion',
  'setPinnedPythonVersion',
  'cleanUvCache',
  'checkGitVersion',
]);
export default invoke;
