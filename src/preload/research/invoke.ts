import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/research';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'getSession',
  'getActiveRequestId',
  'startRequest',
  'focusRequest',
  'focusPageView',
  'createTab',
  'activateTab',
  'closeTab',
  'navigateSearch',
  'goBack',
  'goForward',
  'reloadPage',
  'addCurrentPageAsSource',
  'addSelectedTextAsSource',
  'removeSource',
  'reorderSources',
  'confirmRequest',
  'cancelRequest',
]);

export default invoke;
