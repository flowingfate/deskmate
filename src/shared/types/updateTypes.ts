export interface UpdatePreferences {
  autoUpdateEnabled: boolean;
  skipVersions: string[];
}

export interface UpdateAvailableInfo {
  version?: string;
  latest?: string;
  releaseNotes?: string;
  releaseDate?: string;
  files?: Array<{ url: string; size: number; sha512?: string }>;
  downloadUrl?: string;
}

export interface UpdateNotAvailableInfo {
  version?: string;
}

export interface UpdateDownloadProgress {
  percent: number;
  transferred: string;
  total: string;
  bytesPerSecond?: string;
}

export interface UpdateDownloadedInfo {
  version?: string;
  latest?: string;
  releaseNotes?: string;
  releaseDate?: string;
  filePath?: string;
}

export interface UpdateInstallingInfo {
  phase: string;
  message?: string;
}

export interface UpdaterDownloadProgress {
  percent: number;
  transferred: string;
  total: string;
}
