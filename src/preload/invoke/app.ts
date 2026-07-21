import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/app';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'getVersion',
  'getName',
  'isDev',
  'isReady',
  'getPlatformInfo',
  'getUserDataPath',
  'getInstallationDeviceId',
  'listCrashIncidentsForExport',
  'exportCrashIncident',
  'getAppConfig',
  'updateAppConfig',
]);

export default invoke;
