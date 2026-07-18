import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/profiles';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'list',
  'listManaged',
  'createAndOpen',
  'updateMetadata',
  'delete',
]);

export default invoke;
