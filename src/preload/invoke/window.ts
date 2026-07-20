import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/window';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'minimize',
  'maximize',
  'unmaximize',
  'close',
  'openProfile',
  'isMaximized',
  'isFullScreen',
  'zoomIn',
  'zoomOut',
  'resetZoom',
  'getZoomLevel',
  'showAppMenu',
  'setAlwaysOnTop',
  'isAlwaysOnTop',
  'setSize',
  'getSize',
  'setMinSize',
  'setMaxSize',
  'getMinSize',
  'getMaxSize',
]);

export default invoke;
