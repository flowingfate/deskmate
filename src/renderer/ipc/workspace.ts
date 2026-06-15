/**
 * Renderer-facing `workspaceApi` —— URI-aware proxy at the renderer/IPC boundary.
 *
 * 与 `@/ipc/fs` 同纪律:在原 workspace IPC 之上加一层 URI-aware proxy。主进程
 * 通道保持纯绝对路径契约。
 *
 * URI-aware 方法:
 *
 * - `getFileTree(workspacePath, options?)` —— workspacePath 接 `local://` /
 *   `knowledge://`
 * - `clearFileTreeCache(workspacePath?)` —— 同上
 * - `getDirectoryChildren(dirPath, options?)` —— 同上
 * - `copyPath(sourcePath, destPath, options?)` —— source / dest 任一可为 URI
 * - `copyPaths(sourcePaths[], destPath, options?)` —— 同上
 * - `startWatch(workspacePath, options?)` —— 同上
 * - `searchFiles(query)` —— `query.folder` 字段允许 URI
 *
 * 透传(语义不是"读写文件",保持绝对路径或纯字符串):
 *
 * - `openPath` / `showInFolder` —— shell op
 * - `selectFolder` —— 弹文件夹选择对话框,无 path 入参
 * - `stopWatch` / `getWatcherStats` —— 无 path
 */
import { renderToMain, mainToRender } from '@shared/ipc/workspace';
import type {
  GetFileTreeOptions,
  GetFileTreeResult,
  GetDirectoryChildrenOptions,
  GetDirectoryChildrenResult,
  CopyOptions,
  CopyResult,
  WatchOptions,
  SimpleResult,
  FileSearchQuery,
  SearchFilesResult,
} from '@shared/types/workspaceTypes';
import { resolveUriToPath } from '@/lib/internalUrls';

const raw = renderToMain.bindRender(window.electronAPI.workspace.invoke);

async function toAbs(input: string): Promise<string> {
  return resolveUriToPath(input);
}

async function toAbsMany(inputs: string[]): Promise<string[]> {
  return Promise.all(inputs.map(toAbs));
}

export const workspaceApi = {
  // ── 透传(shell / non-path) ──
  selectFolder: raw.selectFolder,
  openPath: raw.openPath,
  showInFolder: raw.showInFolder,
  stopWatch: raw.stopWatch,
  getWatcherStats: raw.getWatcherStats,

  // ── URI-aware ──
  async getFileTree(
    workspacePath: string,
    options?: GetFileTreeOptions,
  ): Promise<GetFileTreeResult> {
    return raw.getFileTree(await toAbs(workspacePath), options);
  },
  async clearFileTreeCache(workspacePath?: string): Promise<SimpleResult> {
    if (workspacePath === undefined) return raw.clearFileTreeCache();
    return raw.clearFileTreeCache(await toAbs(workspacePath));
  },
  async getDirectoryChildren(
    dirPath: string,
    options?: GetDirectoryChildrenOptions,
  ): Promise<GetDirectoryChildrenResult> {
    return raw.getDirectoryChildren(await toAbs(dirPath), options);
  },
  async copyPath(
    sourcePath: string,
    destPath: string,
    options?: CopyOptions,
  ): Promise<CopyResult> {
    const [src, dest] = await Promise.all([toAbs(sourcePath), toAbs(destPath)]);
    return raw.copyPath(src, dest, options);
  },
  async copyPaths(
    sourcePaths: string[],
    destPath: string,
    options?: CopyOptions,
  ): Promise<CopyResult> {
    const [srcs, dest] = await Promise.all([
      toAbsMany(sourcePaths),
      toAbs(destPath),
    ]);
    return raw.copyPaths(srcs, dest, options);
  },
  async startWatch(
    workspacePath: string,
    options?: WatchOptions,
  ): Promise<SimpleResult> {
    return raw.startWatch(await toAbs(workspacePath), options);
  },
  async searchFiles(query: FileSearchQuery): Promise<SearchFilesResult> {
    if (query.folder === undefined) return raw.searchFiles(query);
    return raw.searchFiles({
      ...query,
      folder: await toAbs(query.folder),
    });
  },
};

export const workspaceEvents = mainToRender.bindRender(
  window.electronAPI.workspace.on,
  window.electronAPI.workspace.off,
);
