import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/runtime';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'installComponent',
  'checkStatus',
  'listPythonVersions',
  'listPythonVersionsFast',
  'installPythonVersion',
  'uninstallPythonVersion',
  'setPinnedPythonVersion',
  'cleanUvCache',
  'checkGitVersion',
]);
export default invoke;
