export type ImportConflictResolution = 'reject' | 'prompt' | 'replace' | 'keep-both' | 'skip';

// ──────────────────────────────────────────────
// deletePaths
// ──────────────────────────────────────────────

export interface DeletePathResult {
  path: string;
  success: boolean;
  error?: string;
}

export type DeletePathsResult =
  | { success: boolean; results: DeletePathResult[]; successCount: number; failCount: number; error?: undefined }
  | { success: false; error: string; results?: undefined; successCount?: undefined; failCount?: undefined };

// ──────────────────────────────────────────────
// listDir
// ──────────────────────────────────────────────

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export type ListDirResult =
  | { success: true; entries: DirEntry[] }
  | { success: false; error: string };

// ──────────────────────────────────────────────
// access
// ──────────────────────────────────────────────

export interface FileAccessResult {
  readable: boolean;
  writable: boolean;
}

// ──────────────────────────────────────────────
// readFile
// ──────────────────────────────────────────────

export type ReadFileResult =
  | { success: true; content: string; size: number; lastModified: number }
  | { success: false; error: string };

// ──────────────────────────────────────────────
// writeFile
// ──────────────────────────────────────────────

export interface WriteFileOptions {
  conflictResolution?: ImportConflictResolution;
}

export type WriteFileResult =
  | { success: true; filePath: string; replaced: boolean; renamed: boolean }
  | { success: true; skipped: true }
  | { success: false; canceled?: boolean; error: string };

// ──────────────────────────────────────────────
// stat
// ──────────────────────────────────────────────

export interface FileStatInfo {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  mtime: number;
  atime: number;
  birthtime: number;
}

export type StatResult =
  | { success: true; stats: FileStatInfo }
  | { success: false; error: string };

// ──────────────────────────────────────────────
// selectFile / selectFiles
// ──────────────────────────────────────────────

export interface DialogFileFilter {
  name: string;
  extensions: string[];
}

export interface SelectFileOptions {
  title?: string;
  filters?: DialogFileFilter[];
}

export type SelectFileResult =
  | { success: true; filePath: string }
  | { success: false; error: string };

export interface SelectFilesOptions {
  title?: string;
  filters?: DialogFileFilter[];
  allowMultiple?: boolean;
}

export type SelectFilesResult =
  | { success: true; filePaths: string[] }
  | { success: false; error: string };

// ──────────────────────────────────────────────
// getFileMetadata
// ──────────────────────────────────────────────

export interface FileMetadata {
  fullPath: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  mimeType: string;
  lineCount?: number;
  lastModified: number;
  isTextFile: boolean;
}

export type GetFileMetadataResult =
  | { success: true; metadata: FileMetadata }
  | { success: false; error: string };

// ──────────────────────────────────────────────
// downloadFile
// ──────────────────────────────────────────────

export type DownloadFileResult =
  | { success: true; filePath: string; size: number }
  | { success: false; error: string };
