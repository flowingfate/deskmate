export type NativeModuleStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface NativeModuleInfo {
  packageName: string;
  version: string;
  status: NativeModuleStatus;
  localPath?: string;
  error?: string;
}

export interface NativeModuleDownloadProgress {
  packageName: string;
  bytesDownloaded: number;
  bytesTotal: number;
  percent: number;
}
