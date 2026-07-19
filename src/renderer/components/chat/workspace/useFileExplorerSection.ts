import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getWorkspaceFileTree,
  getDirectoryChildren,
  clearFileTreeCache,
  isValidWorkspacePath,
  startWatch,
  stopWatch,
  copyPathToWorkspace,
  copyPathsToWorkspace,
  openInSystemExplorer,
  FileTreeNode,
  FileTreeData,
  workspaceOps,
} from '../../../lib/chat/workspaceOps';
import { fsApi } from '@/ipc/fs';
import { workspaceApi } from '@/ipc/workspace';
import { tryResolveUriToPath } from '@/lib/internalUrls';
import { IGNORE_PATTERNS, WATCH_EXCLUDES, isImageFile } from './workspaceConstants';
import { usePasteToWorkspace } from './PasteToWorkspaceProvider';
import { WorkspaceMenuActions } from './WorkspaceExplorerSidepane';
import { ImageViewerAtom } from '@/components/ui/OverlayImageViewer';
import { useOpenFilePreview } from '@/components/filePreview/filePreviewScope';

export interface UseFileExplorerSectionParams {
  rootUri: string;
  agentId: string;
  sessionId: string;
  readOnly?: boolean;
  revealRequest?: { path: string; nonce: number } | null;
  onRevealHandled?: () => void;
  onMenuToggle?: (buttonElement: HTMLElement, menuActions: WorkspaceMenuActions) => void;
}

/** 从拖拽 / 选择得到的浏览器 File 中提取磁盘绝对路径（Electron 提供） */
const extractSourcePath = (file: File): string | undefined => {
  if (window.electronAPI?.fs?.getPathForFile) {
    try {
      const resolved = window.electronAPI.fs.getPathForFile(file);
      if (resolved) return resolved;
    } catch { /* ignore */ }
  }
  // 旧版 Electron 给拖拽 File 附加了磁盘路径，DOM 类型未声明该字段
  const legacyFile = file as File & { path?: string };
  if (typeof legacyFile.path === 'string' && legacyFile.path) {
    return legacyFile.path;
  }
  return undefined;
};

/**
 * FileExplorerSection 的全部数据 / 副作用 / 交互逻辑。
 *
 * 负责：URI→绝对路径解析、文件树加载与懒加载、文件监听、拖拽复制、
 * 折叠态、reveal 请求处理，以及添加文件 / 文件夹 / 粘贴等菜单动作。
 * 视图层只消费返回值，不持有任何业务逻辑。
 */
export function useFileExplorerSection({
  rootUri,
  agentId,
  sessionId,
  readOnly,
  revealRequest,
  onRevealHandled,
  onMenuToggle,
}: UseFileExplorerSectionParams) {
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const { openPasteDialog } = usePasteToWorkspace();
  const imageViewer = ImageViewerAtom.useChange();
  const openFilePreview = useOpenFilePreview();

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const watchStartedRef = useRef(false);
  const fileChangeListenerRef = useRef<(() => void) | null>(null);
  // 子目录懒加载缓存：key = 目录绝对路径，value = true 表示已加载
  const childrenCache = useRef<Map<string, true>>(new Map());

  // 把子节点深度注入树中指定路径的目录节点
  const injectChildren = useCallback((nodes: FileTreeNode[], dirPath: string, children: FileTreeNode[]): FileTreeNode[] => {
    return nodes.map(node => {
      if (node.path === dirPath) {
        return { ...node, children };
      }
      if (node.type === 'directory' && node.children) {
        return { ...node, children: injectChildren(node.children, dirPath, children) };
      }
      return node;
    });
  }, []);

  // 懒加载子节点：用户展开目录时调用
  const handleLoadChildren = useCallback(async (dirPath: string) => {
    if (childrenCache.current.has(dirPath)) return;
    try {
      const result = await getDirectoryChildren(dirPath, { ignorePatterns: IGNORE_PATTERNS });
      const children: FileTreeNode[] = result.success && result.data?.children ? result.data.children : [];
      childrenCache.current.set(dirPath, true);
      setFileTree(prev => injectChildren(prev, dirPath, children));
    } catch { /* ignore */ }
  }, [injectChildren]);

  // 解析 rootUri → workspacePath 绝对路径。`knowledge://` / `local://` 走
  // resolveUriToPath IPC（由 ProtocolHandler 决定 sandbox 根）；非 URI 直接透传。
  // agentId / sessionId 缺失走 tryResolve 静默退化 = 空 state。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = !rootUri
        ? ''
        : await tryResolveUriToPath(rootUri, {
            agentId,
            chatSessionId: sessionId,
          });
      if (!cancelled && resolved !== workspacePath) {
        setWorkspacePath(resolved);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootUri, agentId, sessionId]);

  // 加载文件树（仅加载根目录直接子节点）
  const loadFileTree = useCallback(async (path: string) => {
    if (!path || path.trim() === '') {
      setFileTree([]);
      return;
    }
    setIsLoading(true);
    try {
      const result = await getWorkspaceFileTree(path, { maxDepth: 1, ignorePatterns: IGNORE_PATTERNS });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load file tree');
      }
      const treeData: FileTreeData = result.data;
      setFileTree(treeData.tree || []);
    } catch {
      setFileTree([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reloadRootTree = useCallback(async (path: string, options?: { clearAllCaches?: boolean }) => {
    childrenCache.current.clear();
    try {
      await (options?.clearAllCaches ? clearFileTreeCache() : clearFileTreeCache(path));
    } catch { /* ignore */ }
    await loadFileTree(path);
  }, [loadFileTree]);

  // workspacePath 变化时加载文件树
  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      void reloadRootTree(workspacePath);
    } else {
      childrenCache.current.clear();
      setFileTree([]);
    }
  }, [workspacePath, reloadRootTree]);

  // 读取当前展开目录列表（按路径深度排序，确保父目录先于子目录加载）
  const readExpandedDirs = useCallback((path: string): string[] => {
    let prevExpanded: string[] = [];
    try {
      const saved = localStorage.getItem(`fileTree_expanded_${path}`);
      if (saved) prevExpanded = JSON.parse(saved) as string[];
    } catch { /* ignore */ }
    prevExpanded.sort((a, b) => a.split('/').length - b.split('/').length);
    return prevExpanded;
  }, []);

  // 刷新并恢复之前展开的目录
  const refreshAndRestore = useCallback(async () => {
    if (!isValidWorkspacePath(workspacePath)) return;
    const prevExpanded = readExpandedDirs(workspacePath);
    await reloadRootTree(workspacePath, { clearAllCaches: true });
    for (const dirPath of prevExpanded) {
      await handleLoadChildren(dirPath);
    }
  }, [workspacePath, readExpandedDirs, reloadRootTree, handleLoadChildren]);

  const handleRefresh = refreshAndRestore;

  useEffect(() => {
    if (!revealRequest || revealRequest.path !== workspacePath) return;
    setIsCollapsed(false);
    refreshAndRestore().finally(() => {
      onRevealHandled?.();
    });
  }, [refreshAndRestore, onRevealHandled, revealRequest, workspacePath]);

  // ========== 文件监听 ==========

  const startFileWatcher = useCallback(async (path: string) => {
    if (!path || !isValidWorkspacePath(path)) return;
    if (watchStartedRef.current) return;
    try {
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }
      fileChangeListenerRef.current = workspaceOps.onRefresh(refreshAndRestore);
      const result = await startWatch(path, { excludes: WATCH_EXCLUDES });
      if (result.success) {
        watchStartedRef.current = true;
      }
    } catch { /* ignore */ }
  }, [refreshAndRestore]);

  const stopFileWatcher = useCallback(async () => {
    if (!watchStartedRef.current) return;
    try {
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }
      await stopWatch();
      watchStartedRef.current = false;
    } catch { /* ignore */ }
  }, []);

  // workspacePath 变化时重启文件监听
  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      stopFileWatcher().then(() => startFileWatcher(workspacePath));
    } else {
      stopFileWatcher();
    }
    return () => { stopFileWatcher(); };
  }, [workspacePath, startFileWatcher, stopFileWatcher]);

  // 系统文件管理器打开
  const handleOpenInExplorer = useCallback(async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!isValidWorkspacePath(workspacePath)) return;
    try {
      await openInSystemExplorer(workspacePath);
    } catch { /* ignore */ }
  }, [workspacePath]);

  // 文件点击：图片走 imageViewer atom，其余走就近作用域文件预览
  const handleFileClick = useCallback((node: FileTreeNode) => {
    if (isImageFile(node.name)) {
      imageViewer.open([{ id: node.path, url: `file://${node.path}`, alt: node.name }], 0);
      return;
    }
    openFilePreview({ name: node.name, url: node.path });
  }, [imageViewer, openFilePreview]);

  // ========== 拖拽复制 ==========

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) return;
    setIsDraggingOver(true);
  }, [readOnly]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (readOnly) return;

    if (!isValidWorkspacePath(workspacePath)) return;

    const sourcePaths: string[] = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const sourcePath = extractSourcePath(e.dataTransfer.files[i]);
      if (sourcePath) sourcePaths.push(sourcePath);
    }
    if (sourcePaths.length === 0) return;

    let successCount = 0;
    try {
      const result = await copyPathsToWorkspace(sourcePaths, workspacePath, { conflictResolution: 'prompt' });
      successCount = result.data?.successCount ?? 0;
    } catch { /* ignore */ }

    if (successCount > 0) {
      try {
        await reloadRootTree(workspacePath);
      } catch { /* ignore */ }
    }
  }, [readOnly, workspacePath, reloadRootTree]);

  // 文件树（带路径安全校验，过滤掉不在 workspacePath 下的节点）
  const fileTreeWithRoot = useMemo(() => {
    if (!isValidWorkspacePath(workspacePath)) return [];
    const filterValidNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.filter(node => {
        if (!node.path || !node.path.startsWith(workspacePath)) return false;
        if (node.children) {
          node.children = filterValidNodes(node.children);
        }
        return true;
      });
    };
    return fileTree.length > 0 ? filterValidNodes(fileTree) : [];
  }, [workspacePath, fileTree]);

  const isValid = isValidWorkspacePath(workspacePath);
  const isEmpty = isValid && fileTree.length === 0;

  // ========== 菜单动作 ==========

  const handleAddFiles = useCallback(async () => {
    if (readOnly || !isValidWorkspacePath(workspacePath)) return;
    try {
      const result = await fsApi.selectFiles({ title: 'Select Files or Folders to Add', allowMultiple: true });
      if (!result?.success || !result.filePaths || result.filePaths.length === 0) return;
      let successCount = 0;
      try {
        const copyResult = await copyPathsToWorkspace(result.filePaths, workspacePath, { conflictResolution: 'prompt' });
        successCount = copyResult.data?.successCount ?? 0;
      } catch { /* ignore */ }
      if (successCount > 0) {
        try {
          await reloadRootTree(workspacePath);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, [readOnly, workspacePath, reloadRootTree]);

  const handleAddFolder = useCallback(async () => {
    if (readOnly || !isValidWorkspacePath(workspacePath)) return;
    try {
      const result = await workspaceApi.selectFolder();
      if (!result?.success || !result.folderPath) return;
      const copyResult = await copyPathToWorkspace(result.folderPath, workspacePath, { conflictResolution: 'prompt' });
      if (copyResult.success) {
        try {
          await reloadRootTree(workspacePath);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, [readOnly, workspacePath, reloadRootTree]);

  const handleOpenPasteDialog = useCallback(() => {
    if (readOnly || !isValidWorkspacePath(workspacePath)) return;
    openPasteDialog(workspacePath, workspacePath, () => {
      void reloadRootTree(workspacePath);
    });
  }, [readOnly, workspacePath, openPasteDialog, reloadRootTree]);

  const handleMenuToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (!menuButtonRef.current || !onMenuToggle) return;
    const canMutate = isValidWorkspacePath(workspacePath) && !readOnly;
    onMenuToggle(menuButtonRef.current, {
      onOpenInExplorer: handleOpenInExplorer,
      onAddFiles: handleAddFiles,
      onAddFolder: handleAddFolder,
      onPasteToWorkspace: handleOpenPasteDialog,
      canOpenInExplorer: isValidWorkspacePath(workspacePath),
      canAddFiles: canMutate,
      canAddFolder: canMutate,
      canPasteToWorkspace: canMutate,
      workspacePath,
    });
  }, [onMenuToggle, workspacePath, readOnly, handleOpenInExplorer, handleAddFiles, handleAddFolder, handleOpenPasteDialog]);

  const handleToggleCollapse = useCallback(() => setIsCollapsed(prev => !prev), []);

  // 首次加载 / sidepane 重挂载时，自动恢复已展开目录的内容
  useEffect(() => {
    if (isLoading || fileTree.length === 0 || !isValidWorkspacePath(workspacePath)) return;
    readExpandedDirs(workspacePath).forEach(dirPath => {
      if (!childrenCache.current.has(dirPath)) {
        void handleLoadChildren(dirPath);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTree, workspacePath, isLoading]);

  return {
    workspacePath,
    isLoading,
    isCollapsed,
    isDraggingOver,
    isValid,
    isEmpty,
    fileTreeWithRoot,
    menuButtonRef,
    handleToggleCollapse,
    handleRefresh,
    handleMenuToggle,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileClick,
    handleLoadChildren,
    handleAddFiles,
    handleAddFolder,
    handleOpenPasteDialog,
  };
}
