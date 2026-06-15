import { connectRenderToMain, connectMainToRender } from './base';
import type {
  SelectFolderResult,
  GetFileTreeOptions,
  GetFileTreeResult,
  GetDirectoryChildrenOptions,
  GetDirectoryChildrenResult,
  CopyOptions,
  CopyResult,
  WatchOptions,
  WatcherStatsResult,
  FileSearchQuery,
  SearchFilesResult,
  SimpleResult,
  FileChange,
} from '../types/workspaceTypes';

export type {
  FileTreeNode,
  FileTreeData,
  GetFileTreeOptions,
  GetFileTreeResult,
  GetDirectoryChildrenOptions,
  DirectoryChildrenData,
  GetDirectoryChildrenResult,
  SelectFolderResult,
  CopyOptions,
  CopyResultItem,
  CopyData,
  CopyResult,
  WatchOptions,
  WatcherStats,
  WatcherStatsResult,
  FileChange,
  FileChangeType,
  FileSearchQuery,
  FileSearchResultItem,
  FileSearchComplete,
  SearchFilesResult,
  SimpleResult,
} from '../types/workspaceTypes';

type RenderToMain = {
  selectFolder: { call: []; return: SelectFolderResult };
  getFileTree: { call: [workspacePath: string, options?: GetFileTreeOptions]; return: GetFileTreeResult };
  clearFileTreeCache: { call: [workspacePath?: string]; return: SimpleResult };
  getDirectoryChildren: { call: [dirPath: string, options?: GetDirectoryChildrenOptions]; return: GetDirectoryChildrenResult };
  copyPath: { call: [sourcePath: string, destPath: string, options?: CopyOptions]; return: CopyResult };
  copyPaths: { call: [sourcePaths: string[], destPath: string, options?: CopyOptions]; return: CopyResult };
  startWatch: { call: [workspacePath: string, options?: WatchOptions]; return: SimpleResult };
  stopWatch: { call: []; return: SimpleResult };
  getWatcherStats: { call: []; return: WatcherStatsResult };
  searchFiles: { call: [query: FileSearchQuery]; return: SearchFilesResult };
  openPath: { call: [targetPath: string]; return: SimpleResult };
  showInFolder: { call: [targetPath: string]; return: SimpleResult };
};

type MainToRender = {
  fileChanged: FileChange[];
  watchError: string;
};

export const renderToMain = connectRenderToMain<RenderToMain>('workspace');
export const mainToRender = connectMainToRender<MainToRender>('workspace');
