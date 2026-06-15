// Viewer renderer 端 IPC 入口：把 preload 暴露的桥接接到强类型契约 proxy 上。
//
// preload 暴露的 window.electronLogViewer 形如：
//   { invoke(channel, ...args), on(channel, listener), off(channel, listener) }
// 这里用 shared/ipc/logViewer 的 bindRender 包出契约 proxy，所有方法名 / 参数 / 返回都强类型：
//
//   viewerApi.query({ ... })       Promise<LogRow[]>
//   viewerApi.stats({ ... })       Promise<ViewerStats>
//   viewerApi.getDbPath()          Promise<string>
//   viewerEvents.appended(cb)      返回 unsubscribe
//
// 不再使用手写的 window.viewerAPI 假对象 —— 通道名 / 形状漂移由 base.ts Proxy 自动同步。

import type { IpcRendererEvent } from 'electron';
import { renderToMain, mainToRender } from '@shared/ipc/logViewer';
import type {
  InvokeFn,
  OnOff,
} from '@shared/ipc/base';

interface ElectronLogViewerBridge {
  invoke: InvokeFn;
  on: OnOff;
  off: OnOff;
}

declare global {
  interface Window {
    electronLogViewer?: ElectronLogViewerBridge;
  }
}

function bridge(): ElectronLogViewerBridge {
  const b = window.electronLogViewer;
  if (!b) throw new Error('electronLogViewer bridge missing — preload not loaded');
  return b;
}

// 注意：lazy 取 bridge，避免模块 import 时 preload 还没就绪导致抛错。
export const viewerApi = renderToMain.bindRender((channel, ...args) =>
  bridge().invoke(channel, ...args),
);

export const viewerEvents = mainToRender.bindRender(
  (channel, listener) => bridge().on(channel, listener as (e: IpcRendererEvent, ...args: unknown[]) => void),
  (channel, listener) => bridge().off(channel, listener as (e: IpcRendererEvent, ...args: unknown[]) => void),
);
