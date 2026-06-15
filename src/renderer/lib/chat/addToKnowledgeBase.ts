// src/renderer/lib/chat/addToKnowledgeBase.ts
// 把 session sandbox / 其它 fs 路径下的文件 reflink copy 到 agent KB 目录。
// 源文件保留 → session 历史里 `local://uploads/foo.md` 始终有效;KB 里的
// 副本走 `knowledge://foo.md` 独立访问,两份各自演化、互不影响。

import { workspaceOps } from './workspaceOps';
import { log } from '@/log';
import { workspaceApi } from '@/ipc/workspace';
import { isFileUri } from '@/lib/internalUrls';
const logger = log.child({ mod: 'AddToKnowledgeBase' });

/**
 * 文件是否已经在 KB 内 —— 仅看 URI scheme。`knowledge://` 即"位于 KB",
 * 其它一切(`local://` / 绝对路径 / 任意字符串)一律返回 false。
 */
export function isPathInKnowledgeBase(fileUriOrPath: string): boolean {
  return !!fileUriOrPath && fileUriOrPath.startsWith('knowledge://');
}

/**
 * "是否显示 Add to KB":session idle + 非 KB 内文件。
 * 与 `isPathInKnowledgeBase` 同步简化,不再接受 KB 绝对路径形参。
 */
export function shouldShowAddToKnowledgeBaseOption(
  fileUriOrPath: string,
  isSessionIdle: boolean = true,
): boolean {
  if (!fileUriOrPath || !isSessionIdle) return false;
  return !isPathInKnowledgeBase(fileUriOrPath);
}

/**
 * 把单个文件 reflink copy 到 KB。源保留;chat 历史里指向源的引用继续有效。
 *
 * @param sourceUriOrPath - URI(`local://...` / `knowledge://...`)或绝对路径
 * @returns 成功时附 `newPath` 指向 KB 里的副本;冲突走 main 端系统对话框
 */
export async function addFileToKnowledgeBase(
  sourceUriOrPath: string,
): Promise<{ success: boolean; newPath?: string; error?: string }> {
  try {
    // copyPaths(`conflictResolution: 'prompt'`)冲突时 main 弹原生对话框。
    // source / dest 均接 URI,workspaceApi wrapper 内部 resolve。
    const result = await workspaceApi.copyPaths([sourceUriOrPath], 'knowledge://', {
      conflictResolution: 'prompt',
    });

    if (result.canceled) {
      return { success: false, error: 'User cancelled replacement' };
    }
    if (!result.success) {
      return { success: false, error: result.error || 'Failed to copy file' };
    }

    const item = result.data?.results?.[0];
    if (!item) {
      return { success: false, error: 'Copy completed but no result returned' };
    }
    if (!item.success) {
      return { success: false, error: item.error || 'Copy failed' };
    }
    if (item.skipped) {
      // 用户在冲突对话框里选了 skip。这里仍当成功返回但没 newPath。
      return { success: true };
    }

    // 刷新文件树缓存 + 触发 FileExplorerSection 重渲染。
    try {
      await workspaceOps.clearFileTreeCache('knowledge://');
      workspaceOps.triggerRefresh();
    } catch (refreshError) {
      logger.warn({ msg: 'Failed to refresh file tree caches', data: refreshError });
      // Non-fatal
    }

    return { success: true, newPath: item.targetPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ msg: 'addFileToKnowledgeBase failed', err: errorMessage, src: sourceUriOrPath });
    return { success: false, error: errorMessage };
  }
}

/** Re-export so callers don't need a separate import for the URI helper. */
export { isFileUri };
