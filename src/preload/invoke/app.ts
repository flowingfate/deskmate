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
  'getCrashCaptureStatus',
  'recordCrashBreadcrumb',
  'reportRendererError',
  'getAppConfig',
  'updateAppConfig',
]);

export default invoke;
