// Log Viewer 专属 preload。
//
// 暴露给 renderer 的最小面（全部走 src/shared/ipc 强类型框架）：
//   electronLogViewer.invoke  → renderToMain（getDbPath / query / stats），白名单守 main 处理器
//   electronLogViewer.on/off  → mainToRender 监听（appended 增量推送）
//
// 故意不暴露 log.write —— viewer 自身的异常只走 console，避免 viewer 渲染日志成环
// （viewer → IPC → sqlite → broadcast → viewer 刷新 → ...）。
//
// Renderer 端通过 src/renderer/log-viewer/api.ts 把上面三个原语接到契约 proxy 上。

import { contextBridge, ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/logViewer';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'getDbPath',
  'query',
  'stats',
  'lives',
]);

contextBridge.exposeInMainWorld('electronLogViewer', {
  invoke,
  on: ipcRenderer.on.bind(ipcRenderer),
  off: ipcRenderer.off.bind(ipcRenderer),
});
