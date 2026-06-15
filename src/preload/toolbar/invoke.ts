import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/toolbar';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'show',
  'hide',
  'toggle',
  'isVisible',
  'setAlwaysOnTop',
  'isAlwaysOnTop',
  'getPosition',
  'setPosition',
  'getSettings',
  'updateSettings',
  'updateShortcut',
  'resetPosition',
]);

export default invoke;
