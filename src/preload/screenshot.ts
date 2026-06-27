import { contextBridge, ipcRenderer } from 'electron';
import type { LogFields, LogLevel } from '@shared/log/types';
import invoke from './screenshot/invoke';

contextBridge.exposeInMainWorld('electronScreenshot', {
  invoke,
  on: ipcRenderer.on.bind(ipcRenderer),
  off: ipcRenderer.off.bind(ipcRenderer),
});

// 截图窗口同样需要 @/log（installGlobalErrorHandlers + log.child），
// 它依赖 window.electronAPI.log.write/writeBatch。仅暴露 log 命名空间，
// 其余主窗口 API 不在此窗口注入。
contextBridge.exposeInMainWorld('electronAPI', {
  log: {
    write: (level: LogLevel, fields: LogFields) =>
      ipcRenderer.send('log:write', { level, fields }),
    writeBatch: (entries: { level: LogLevel; fields: LogFields }[]) =>
      ipcRenderer.send('log:writeBatch', entries),
  },
});
