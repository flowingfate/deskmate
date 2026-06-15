import { contextBridge, ipcRenderer } from 'electron';
import './main';
import invokeMainWindow from './mainWindow/invoke';
import invokeToolbar from './toolbar/invoke';
import invokePersist from './persist/invoke';
import type { InvokeFn, OnOff } from '@shared/ipc/base';

export type { ElectronAPI } from './main';

const ipcOn: OnOff = ipcRenderer.on.bind(ipcRenderer);
const ipcOff: OnOff = ipcRenderer.off.bind(ipcRenderer);

// Define the ToolBar-specific API interface (principle of least privilege)
export interface ToolBarElectronAPI {
  // toolbar namespace - ToolBar window control (typed IPC)
  toolbar: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // mainWindow namespace - main window control (called from ToolBar, typed IPC)
  mainWindow: {
    invoke: InvokeFn;
  };

  // persist namespace - 新持久化层（取代老 profile 通道）
  persist: {
    invoke: InvokeFn;
    on: OnOff;
    off: OnOff;
  };

  // Platform information
  platform: string;
}

// Implementation of the ToolBar Electron API
const toolBarElectronAPI: ToolBarElectronAPI = {
  toolbar: {
    invoke: invokeToolbar,
    on: ipcOn,
    off: ipcOff,
  },

  mainWindow: {
    invoke: invokeMainWindow,
  },

  persist: {
    invoke: invokePersist,
    on: ipcOn,
    off: ipcOff,
  },

  // Platform information
  platform: process.platform,
};

if ((process as any).contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('toolbarElectronAPI', toolBarElectronAPI);
  } catch (error) {
  }
} else {
  (window as any).toolbarElectronAPI = toolBarElectronAPI;
}
