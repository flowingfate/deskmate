// Research 窗口专属 preload。
//
// Research window 与外部网页 WebContentsView 共处同一 BrowserWindow，并把
// 抓取到的页面标题/正文渲染进 DOM。即便它是第一方 chrome，也必须遵循最小权限：
// 只暴露 research 控制 IPC，绝不复用 main preload（那会把 persist/llm/mcp/
// local tools 等全部主进程能力开放给 research renderer，放大被攻击面）。
//
// 暴露面（全部走 src/shared/ipc 强类型框架）：
//   electronAPI.research.invoke  → renderToMain 白名单（getSession / tab / source / confirm 等）
//   electronAPI.research.on/off  → mainToRender 监听（updated / completed 推送）
//   electronAPI.log.write/Batch  → 仅日志写入通道，与 screenshot 窗口对齐
//
// Renderer 端 src/renderer/ipc/research.ts 读取 window.electronAPI.research 接到契约 proxy。

import { contextBridge, ipcRenderer } from 'electron';
import type { LogFields, LogLevel } from '@shared/log/types';
import invoke from './research/invoke';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  research: {
    invoke,
    on: ipcRenderer.on.bind(ipcRenderer),
    off: ipcRenderer.off.bind(ipcRenderer),
  },
  log: {
    write: (level: LogLevel, fields: LogFields) =>
      ipcRenderer.send('log:write', { level, fields }),
    writeBatch: (entries: { level: LogLevel; fields: LogFields }[]) =>
      ipcRenderer.send('log:writeBatch', entries),
  },
});
