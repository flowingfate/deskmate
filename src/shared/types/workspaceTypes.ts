import type { ImportConflictResolution } from './fsTypes';

// ──────────────────────────────────────────────
// File tree
// ──────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

export interface FileTreeData {
  workspacePath: string;
  workspaceName: string;
  tree: FileTreeNode[];
}

export interface GetFileTreeOptions {
  maxDepth?: number;
  ignorePatterns?: string[];
}

export interface GetFileTreeResult {
  success: boolean;
  data?: FileTreeData;
  error?: string;
}

export interface GetDirectoryChildrenOptions {
  ignorePatterns?: string[];
}

export interface DirectoryChildrenData {
  dirPath: string;
  children: FileTreeNode[];
}

export interface GetDirectoryChildrenResult {
  success: boolean;
  data?: DirectoryChildrenData;
  error?: string;
}

// ──────────────────────────────────────────────
// Folder select
// ──────────────────────────────────────────────

export interface SelectFolderResult {
  success: boolean;
  folderPath?: string;
  error?: string;
}

// ──────────────────────────────────────────────
// Copy / Move
// ──────────────────────────────────────────────

export interface CopyOptions {
  conflictResolution?: ImportConflictResolution;
}

export interface CopyResultItem {
  sourcePath: string;
  targetPath?: string;
  success: boolean;
  skipped?: boolean;
  renamed?: boolean;
  replaced?: boolean;
  error?: string;
}

export interface CopyData {
  results: CopyResultItem[];
  successCount: number;
  failCount: number;
  skippedCount: number;
  renamedCount: number;
}

export interface CopyResult {
  success: boolean;
  canceled?: boolean;
  data?: CopyData;
  error?: string;
}
// ──────────────────────────────────────────────
// Watch
// ──────────────────────────────────────────────

export interface WatchOptions {
  excludes?: string[];
  includes?: string[];
}

export interface WatcherStats {
  watchedPath: string | null;
  isWatching: boolean;
  startTime: number | null;
  changeCount: number;
  lastChangeTime: number | null;
}

export interface WatcherStatsResult {
  success: boolean;
  data?: WatcherStats;
  error?: string;
}

export enum FileChangeType {
  UPDATED = 0,
  ADDED = 1,
  DELETED = 2,
}

export interface FileChange {
  type: FileChangeType;
  path: string;
}

// ──────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────

export interface FileSearchQuery {
  folder?: string;
  pattern?: string;
  maxResults?: number;
  fuzzy?: boolean;
  searchTarget?: 'files' | 'folders' | 'both';
}

export interface FileSearchResultItem {
  path: string;
  score?: number;
  isDirectory?: boolean;
}

export interface FileSearchComplete {
  results: FileSearchResultItem[];
  limitHit?: boolean;
  stats?: {
    duration: number;
    filesScanned: number;
    cacheHit: boolean;
  };
}

export interface SearchFilesResult {
  success: boolean;
  data?: FileSearchComplete;
  error?: string;
}

// ──────────────────────────────────────────────
// Open / Show
// ──────────────────────────────────────────────

export interface SimpleResult {
  success: boolean;
  error?: string;
}

