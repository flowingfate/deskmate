import type { IpcMain, IpcRenderer, WebContents, IpcMainInvokeEvent, BrowserWindow, ContextBridge } from 'electron';
import type { InteractiveMap } from '../types/interactiveRequestTypes';
import Resolveable from '../resolveable-promise';


type RequestType = keyof InteractiveMap;
const PREFIX = '_human_in_loop_';

/**
 * Main process API
 */
const tasks = new Map<string, Resolveable<any>>();

export function listenInMain(ipc: IpcMain) {
  ipc.on(`${PREFIX}:callback`, async (_e: IpcMainInvokeEvent, payload: any) => {
    const { mid, result, error } = payload;
    const task = tasks.get(mid);
    if (task) {
      if (error) task.reject(error)
      else task.resolve(result);
      tasks.delete(mid);
    }
  });
}

export function request<K extends RequestType>(
  type: K,
  payload: InteractiveMap[K]['in'],
  id: string,
) {
  function to(target: WebContents | BrowserWindow): Resolveable<InteractiveMap[K]['out']> {
    const data = { mid: id, payload };
    if ('webContents' in target) {
      target.webContents.send(`${PREFIX}:${type}`, data);
    } else {
      target.send(`${PREFIX}:${type}`, data);
    }
    const task = new Resolveable<InteractiveMap[K]['out']>();
    tasks.set(id, task);
    return task;
  }

  return { to };
}

/**
 * Preload API — call once to bridge main ↔ renderer
 */
export function provideInPreload(bridge: ContextBridge, ipc: IpcRenderer) {
  bridge.exposeInMainWorld(PREFIX, {
    on: (type: string, listener: (event: any, ...args: any[]) => void) => {
      ipc.on(`${PREFIX}:${type}`, listener);
    },
    emit: (type: string, result: any) => {
      if (type.startsWith(PREFIX)) ipc.send(type, result);
    },
  });
}

/**
 * Renderer process API
 */
export function onRequest<K extends keyof InteractiveMap>(
  type: K,
  handle: (req: InteractiveMap[K]['in'], mid: string) => Promise<InteractiveMap[K]['out']>,
) {
  const { on, emit } = (window as any)[PREFIX];
  on(type, async (_event: any, data: any) => {
    const { mid, payload } = data;
    try {
      const result = await handle(payload, mid);
      emit(`${PREFIX}:callback`, { mid, result });
    } catch (error) {
      emit(`${PREFIX}:callback`, { mid, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
