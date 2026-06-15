import { connectRenderToMain, connectMainToRender } from './base';
import type { IpcResult } from './result';
import type {
  UpdatePreferences,
  UpdateAvailableInfo,
  UpdateNotAvailableInfo,
  UpdateDownloadProgress,
  UpdateDownloadedInfo,
  UpdateInstallingInfo,
  UpdaterDownloadProgress,
} from '../types/updateTypes';

type RenderToMain = {
  checkForUpdates: { call: [silent?: boolean]; return: IpcResult };
  downloadUpdate: { call: [downloadUrl?: string]; return: IpcResult };
  quitAndInstall: { call: [filePath?: string]; return: void };
  getVersion: { call: []; return: string };
  skipVersion: { call: [version: string]; return: IpcResult };
  getPreferences: { call: []; return: IpcResult<UpdatePreferences> };
  updatePreferences: { call: [preferences: Partial<UpdatePreferences>]; return: IpcResult };
};

type MainToRender = {
  checkPhaseChanged: { phase: string };
  checkingForUpdate: undefined;
  updateAvailable: UpdateAvailableInfo;
  updateNotAvailable: UpdateNotAvailableInfo;
  updateError: string;
  updaterDownloadProgress: UpdaterDownloadProgress;
  updaterDownloadFailed: { error: string };
  downloadProgress: UpdateDownloadProgress;
  updateDownloaded: UpdateDownloadedInfo;
  updateInstalling: UpdateInstallingInfo;
};

export const renderToMain = connectRenderToMain<RenderToMain>('update');
export const mainToRender = connectMainToRender<MainToRender>('update');
