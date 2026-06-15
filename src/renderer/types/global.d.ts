import { ElectronAPI } from '../../preload/main';
import { ToolBarElectronAPI } from '../../preload/toolbar';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    toolbarElectronAPI: ToolBarElectronAPI;
    updateProviderInitialized?: boolean;
  }
}

export {};