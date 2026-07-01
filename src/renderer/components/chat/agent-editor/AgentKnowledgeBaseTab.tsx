import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  FileType,
  Palette,
  Globe,
  Image as ImageIcon,
  FolderPlus,
  ChevronLeft,
  ChevronRight,
  File,
  Trash2,
  Clipboard,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/shadcn/button';

import { fsApi } from '@/ipc/fs';
import { workspaceApi } from '@/ipc/workspace';
import { TabComponentProps } from './types';
import {
  getWorkspaceFileTree,
  getDirectoryChildren,
  clearFileTreeCache,
  isValidWorkspacePath,
  startWatch,
  stopWatch,
  copyPathToWorkspace,
  copyPathsToWorkspace,
  FileTreeNode,
  FileTreeData,
  workspaceOps,
} from '../../../lib/chat/workspaceOps';
import { resolveUriToPath } from '@/lib/internalUrls';
import { usePasteToWorkspace } from '../workspace/PasteToWorkspaceProvider';
import { log } from '@/log';
import { FileTreeNodeMenuAtom } from '@renderer/components/menu/FileTreeNodeContextMenu';
const logger = log.child({ mod: 'AgentKnowledgeBaseTab' });

// Shared ignore directory patterns for all features
const IGNORE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.vscode', '.idea'
];

// Image file extensions set
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico', 'tiff', 'tif']);
const isImageFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
};

/**
 * AgentKnowledgeBaseTab - Agent Knowledge Base configuration tab
 *
 * Features:
 * - Display and manage the Agent's Knowledge Base directory
 * - File/folder browsing and navigation
 * - Style kept consistent with SkillFolderExplorer
 * - Image files open with OverlayImageViewer; other files open with OverlayFileViewer
 * - Folder watching sync kept consistent with WorkspaceExplorerSidepane
 * - Shows different empty-state messages based on brand
 */

// File icon component - consistent with SkillFolderExplorer
const FileIcon: React.FC<{ extension: string | null; fileName?: string }> = ({ extension, fileName }) => {
  const ext = extension?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode size={16} />;
    case 'json':
      return <FileJson size={16} />;
    case 'md':
      return <FileType size={16} />;
    case 'css':
    case 'scss':
      return <Palette size={16} />;
    case 'html':
      return <Globe size={16} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return <ImageIcon size={16} />;
    default:
      return <FileText size={16} />;
  }
};

// Loading animation component - consistent with SkillFolderExplorer
const LoadingSpinner = () => (
  <div className="flex flex-col items-center justify-center gap-4 px-5 py-16 text-content-secondary">
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="animate-spin"
    >
      <circle cx="16" cy="16" r="14" stroke="#e0e0e0" strokeWidth="2"/>
      <path d="M30 16C30 23.732 23.732 30 16 30" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
    </svg>
    <span className="text-base">Loading directory...</span>
  </div>
);

// Format file size - consistent with SkillFolderExplorer
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const AgentKnowledgeBaseTab: React.FC<TabComponentProps> = ({
  agentId,
  agentData,
  readOnly = false,
}) => {

  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [directoryStack, setDirectoryStack] = useState<FileTreeNode[]>([]);
  const directoryStackRef = useRef<FileTreeNode[]>([]);
  const navigationVersionRef = useRef(0);
  const reloadRequestIdRef = useRef(0);
  const [pathHistory, setPathHistory] = useState<string[]>([]);



  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const { openPasteDialog } = usePasteToWorkspace();
  const watchStartedRef = useRef(false);
  const fileChangeListenerRef = useRef<(() => void) | null>(null);
  const childrenCache = useRef<Map<string, FileTreeNode[]>>(new Map());




  // Knowledge Base 路径已固定为 `${agentRoot}/knowledge`(撤掉自定义之后),
  // renderer 不再读 agentData.knowledgeBase —— 通过 `knowledge://` URI 一次性
  // 解析为绝对路径喂给 file-tree IPC,与 WorkspaceExplorerSidepane 共享同一抽象。
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    resolveUriToPath('knowledge://', { agentId })
      .then((abs) => {
        if (!cancelled) setWorkspacePath(abs);
      })
      .catch((err) => {
        logger.error({ msg: 'Failed to resolve knowledge:// to abs path', err });
        if (!cancelled) setWorkspacePath('');
      });
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    directoryStackRef.current = directoryStack;
  }, [directoryStack]);

  const markNavigationChanged = useCallback(() => {
    navigationVersionRef.current += 1;
  }, []);



// Load file tree (only load direct children of root directory, subdirectories are lazy-loaded)
  const loadFileTree = useCallback(async (path: string) => {
    if (!path || path.trim() === '') {
      setFileTree([]);
      return;
    }

    setIsLoading(true);
    try {
      const result = await getWorkspaceFileTree(path, {
        maxDepth: 1,  // Only load direct children of root level
        ignorePatterns: IGNORE_PATTERNS
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to load file tree');
      }

      const treeData = result.data as FileTreeData;
      setFileTree(treeData.tree || []);
    } catch (error) {
      logger.error({ msg: "Failed to load file tree:", err: error });
      setFileTree([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reloadExplorer = useCallback(async (
    path: string,
    options?: { preserveNavigation?: boolean; resetNavigation?: boolean; clearAllCaches?: boolean }
  ) => {
    const reloadRequestId = ++reloadRequestIdRef.current;
    const navigationSnapshot = options?.preserveNavigation ? [...directoryStackRef.current] : [];
    const navigationVersionSnapshot = navigationVersionRef.current;
    const isReloadStale = () => (
      reloadRequestId !== reloadRequestIdRef.current ||
      navigationVersionRef.current !== navigationVersionSnapshot
    );

    childrenCache.current.clear();

    try {
      if (options?.clearAllCaches) {
        await clearFileTreeCache();
      } else {
        await clearFileTreeCache(path);
      }
    } catch (error) {
      logger.error({ msg: "Failed to clear cache before reload:", err: error });
    }

    await loadFileTree(path);

    if (reloadRequestId !== reloadRequestIdRef.current) {
      return;
    }

    if (options?.resetNavigation) {
      setDirectoryStack([]);
      setPathHistory([]);
      return;
    }

    if (!options?.preserveNavigation || navigationSnapshot.length === 0) {
      return;
    }

    const rebuiltStack: FileTreeNode[] = [];
    for (const existingNode of navigationSnapshot) {
      if (isReloadStale()) {
        return;
      }

      let children: FileTreeNode[] = [];
      try {
        const result = await getDirectoryChildren(existingNode.path, { ignorePatterns: IGNORE_PATTERNS });
        children = result.success ? (result.data?.children as FileTreeNode[] || []) : [];
      } catch (error) {
        logger.error({ msg: "Failed to rebuild directory children during reload:", err: error });
      }

      childrenCache.current.set(existingNode.path, children);
      rebuiltStack.push({ name: existingNode.name, path: existingNode.path, type: 'directory', children });
    }

    if (isReloadStale()) {
      return;
    }

    setDirectoryStack(rebuiltStack);
  }, [loadFileTree]);

  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      void reloadExplorer(workspacePath, { resetNavigation: true });
    } else {
      childrenCache.current.clear();
      setFileTree([]);
      setDirectoryStack([]);
      setPathHistory([]);
    }
  }, [workspacePath, reloadExplorer]);

  const handleFileChanges = useCallback(async () => {
    if (isValidWorkspacePath(workspacePath)) {
      await reloadExplorer(workspacePath, { resetNavigation: true, clearAllCaches: true });
    }
  }, [workspacePath, reloadExplorer]);

  const startFileWatcher = useCallback(async (path: string) => {
    if (!path || !isValidWorkspacePath(path)) {
      return;
    }

    if (watchStartedRef.current) {
      return;
    }

    try {
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }
      const removeListener = workspaceOps.onRefresh(handleFileChanges);
      fileChangeListenerRef.current = removeListener;
      const result = await startWatch(path, {
        excludes: [
          'node_modules',
          '.git',
          'dist',
          'build',
          '.next',
          'out',
          'coverage',
          '.vscode',
          '.idea',
          '.DS_Store',
          'Thumbs.db'
        ]
      });

      if (result.success) {
        watchStartedRef.current = true;
      }
    } catch (error) {
      logger.error({ msg: "Failed to start file watcher:", err: error });
    }
  }, [handleFileChanges]);

  const stopFileWatcher = useCallback(async () => {
    if (!watchStartedRef.current) {
      return;
    }

    try {
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }
      await stopWatch();
      watchStartedRef.current = false;
    } catch (error) {
      logger.error({ msg: "Failed to stop file watcher:", err: error });
    }
  }, []);

  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      stopFileWatcher().then(() => {
        startFileWatcher(workspacePath);
      });
    } else {
      stopFileWatcher();
    }
    return () => {
      stopFileWatcher();
    };
  }, [workspacePath, startFileWatcher, stopFileWatcher]);

  // Get currently displayed nodes (convert FileTreeNode to DirectoryItem format)
  const currentItems = useMemo(() => {
    let nodes: FileTreeNode[];
    if (directoryStack.length === 0) {
      nodes = fileTree;
    } else {
      const currentDir = directoryStack[directoryStack.length - 1];
      nodes = currentDir.children || [];
    }

    // Convert to same format as SkillFolderExplorer
    return nodes.map(node => ({
      name: node.name,
      path: node.path,
      isDirectory: node.type === 'directory',
      isFile: node.type === 'file',
      size: (node as any).size || 0,
      modifiedTime: (node as any).modifiedTime || '',
      extension: node.type === 'file' ? node.name.split('.').pop() || null : null,
    }));
  }, [fileTree, directoryStack]);

  // Get current path (relative path)
  const currentRelativePath = useMemo(() => {
    if (directoryStack.length === 0) {
      return '';
    }
    // Build relative path
    return directoryStack.map(node => node.name).join('/');
  }, [directoryStack]);

  // Build breadcrumb path - consistent with SkillFolderExplorer
  const getBreadcrumbParts = useCallback(() => {
    const rootName = workspacePath ? workspacePath.split(/[/\\]/).pop() || 'Workspace' : 'Workspace';
    const parts = [{ name: rootName, path: '' }];

    if (directoryStack.length > 0) {
      let accumulatedPath = '';
      directoryStack.forEach(node => {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${node.name}` : node.name;
        parts.push({ name: node.name, path: accumulatedPath });
      });
    }

    return parts;
  }, [workspacePath, directoryStack]);

  // Handle back button
  const handleBack = useCallback(() => {
    markNavigationChanged();
    if (pathHistory.length > 0) {
      const previousStackLength = pathHistory[pathHistory.length - 1];
      setPathHistory(prev => prev.slice(0, -1));
      setDirectoryStack(prev => prev.slice(0, parseInt(previousStackLength, 10)));
    } else if (directoryStack.length > 0) {
      setDirectoryStack(prev => prev.slice(0, -1));
    }
  }, [directoryStack, markNavigationChanged, pathHistory]);

  // Handle breadcrumb click
  const handleBreadcrumbClick = useCallback((targetIndex: number) => {
    // If clicking current location, do nothing
    if (targetIndex === directoryStack.length) {
      return;
    }

    markNavigationChanged();

    if (targetIndex === 0) {
      // Return to root directory
      setPathHistory([]);
      setDirectoryStack([]);
    } else {
      // Navigate to specified directory
      setPathHistory(prev => [...prev, String(directoryStack.length)]);
      setDirectoryStack(prev => prev.slice(0, targetIndex));
    }
  }, [directoryStack, markNavigationChanged]);

  // Handle directory click: lazy load children, prioritize cache
  const handleDirectoryClick = useCallback(async (item: { path: string; name: string }) => {
    let children = childrenCache.current.get(item.path);
    if (children === undefined) {
      // Cache miss, get direct children of this directory from main process
      setIsLoading(true);
      try {
        const result = await getDirectoryChildren(item.path, { ignorePatterns: IGNORE_PATTERNS });
        children = result.success ? (result.data?.children as FileTreeNode[] || []) : [];
      } catch (error) {
        logger.error({ msg: "Failed to load directory children:", err: error });
        children = [];
      } finally {
        setIsLoading(false);
      }
      childrenCache.current.set(item.path, children);
    }
    // Push directory node with loaded children onto stack
    const node: FileTreeNode = { name: item.name, path: item.path, type: 'directory', children };
    markNavigationChanged();
    setPathHistory(prev => [...prev, String(directoryStack.length)]);
    setDirectoryStack(prev => [...prev, node]);
  }, [directoryStack, markNavigationChanged]);

  // Handle file click - use OverlayImageViewer for images, OverlayFileViewer for other files
  const handleFileClick = useCallback((item: { path: string; name: string; size?: number }) => {
    if (isImageFile(item.name)) {
      // Collect all image files in current directory
      const imageItems = currentItems.filter(i => i.isFile && isImageFile(i.name));
      const images = imageItems.map(i => ({
        id: i.path,
        url: `file://${i.path}`,
        alt: i.name,
      }));
      const index = imageItems.findIndex(i => i.path === item.path);
      window.dispatchEvent(new CustomEvent('imageViewer:open', {
        detail: { images, initialIndex: index >= 0 ? index : 0 },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('fileViewer:open', {
        detail: {
          file: {
            name: item.name,
            url: item.path,
            size: item.size,
          },
        },
      }));
    }
  }, [currentItems]);

  // ========== Drag and drop feature - consistent with WorkspaceExplorerSidepane ==========

  // Handle drag enter
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!readOnly && isValidWorkspacePath(workspacePath)) {
      setIsDraggingOver(true);
    }
  }, [readOnly, workspacePath]);

  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if really left the container (and not just entered a child element)
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as Node;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setIsDraggingOver(false);
    }
  }, []);

  // Handle file drop
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    logger.debug({ msg: "handleDrop triggered" });
    logger.debug({ msg: "readOnly:", data: readOnly });
    logger.debug({ msg: "workspacePath:", data: workspacePath });
    logger.debug({ msg: "isValidWorkspacePath:", data: isValidWorkspacePath(workspacePath) });

    if (readOnly || !isValidWorkspacePath(workspacePath)) {
      logger.debug({ msg: "Drop aborted - readOnly or invalid path" });
      return;
    }

    // Get dragged file paths
    const files = e.dataTransfer.files;
    logger.debug({ msg: "Files count:", data: files.length });

    if (files.length === 0) {
      logger.debug({ msg: "No files in drop" });
      return;
    }

    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0
      ? directoryStack[directoryStack.length - 1].path
      : workspacePath;

    logger.debug({ msg: "Target directory:", data: targetDir });

    // Process each dragged file/directory
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // 🔥 Use Electron webUtils.getPathForFile() API to get file path
      let sourcePath: string | undefined;

      // First try using Electron API
      if (window.electronAPI?.fs?.getPathForFile) {
        try {
          sourcePath = window.electronAPI.fs.getPathForFile(file);
          logger.debug({ msg: "Got path from webUtils.getPathForFile:", data: sourcePath });
        } catch (err) {
          logger.warn({ msg: "webUtils.getPathForFile failed:", err: err });
        }
      }

      // If Electron API fails, try using file.path (legacy Electron)
      if (!sourcePath && (file as any).path) {
        sourcePath = (file as any).path;
        logger.debug({ msg: "Got path from file.path:", data: sourcePath });
      }

      logger.debug({ msg: "Processing file", fileName: file.name, sourcePath });

      if (!sourcePath) {
        logger.debug({ msg: "No path for file:", data: file.name });
        continue;
      }

      try {
        logger.debug({ msg: "Copying", sourcePath, targetDir });
        const result = await copyPathToWorkspace(sourcePath, targetDir, {
          conflictResolution: 'prompt',
        });

        logger.debug({ msg: "Copy result:", data: result });

        if (result.success) {
          successCount++;
        } else {
          failCount++;
          logger.error({ msg: "Failed to copy:", err: result.error, sourcePath });
        }
      } catch (error) {
        failCount++;
        logger.error({ msg: "Error copying file:", err: error, data: sourcePath });
      }
    }

    logger.debug({ msg: "Copy complete", successCount, failCount });

    // Refresh file tree after copying
    if (successCount > 0) {
      try {
        await reloadExplorer(workspacePath, { preserveNavigation: true });
        logger.debug({ msg: "File tree refreshed" });
      } catch (error) {
        logger.error({ msg: "Failed to refresh file tree:", err: error });
      }
    }
  }, [readOnly, workspacePath, directoryStack, reloadExplorer]);

  // ========== Add Files feature ==========

  // Handle add files button click
  const handleAddFiles = useCallback(async () => {
    if (readOnly || !isValidWorkspacePath(workspacePath)) {
      return;
    }

    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0
      ? directoryStack[directoryStack.length - 1].path
      : workspacePath;

    logger.debug({ msg: "handleAddFiles - target directory:", data: targetDir });

    try {
      // Show file selection dialog, supports multiple files and directories
      const result = await fsApi.selectFiles({
        title: 'Select Files or Folders to Add',
        allowMultiple: true,
      });

      logger.debug({ msg: "File selection result:", data: result });

      if (!result?.success || !result.filePaths || result.filePaths.length === 0) {
        logger.debug({ msg: "File selection canceled or no files selected" });
        return;
      }

      // Copy selected files/directories to target directory
      let successCount = 0;
      let failCount = 0;

      try {
        const copyResult = await copyPathsToWorkspace(result.filePaths, targetDir, {
          conflictResolution: 'prompt',
        });
        successCount = copyResult.data?.successCount ?? 0;
        failCount = copyResult.data?.failCount ?? 0;
      } catch (error) {
        failCount = result.filePaths.length;
        logger.error({ msg: "Error copying:", err: error });
      }

      logger.debug({ msg: "Add Files complete", successCount, failCount });

      // Refresh file tree after copying
      if (successCount > 0) {
        try {
          await reloadExplorer(workspacePath, { preserveNavigation: true });
          logger.debug({ msg: "File tree refreshed after adding files" });
        } catch (error) {
          logger.error({ msg: "Failed to refresh file tree:", err: error });
        }
      }
    } catch (error) {
      logger.error({ msg: "Error in handleAddFiles:", err: error });
    }
  }, [readOnly, workspacePath, directoryStack, reloadExplorer]);

  // Handle add folder button click
  const handleAddFolder = useCallback(async () => {
    if (readOnly || !isValidWorkspacePath(workspacePath)) {
      return;
    }

    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0
      ? directoryStack[directoryStack.length - 1].path
      : workspacePath;

    logger.debug({ msg: "handleAddFolder - target directory:", data: targetDir });

    try {
      // Show folder selection dialog
      const result = await workspaceApi.selectFolder();

      logger.debug({ msg: "Folder selection result:", data: result });

      if (!result?.success || !result.folderPath) {
        logger.debug({ msg: "Folder selection canceled" });
        return;
      }

      // Copy selected folder to target directory
      try {
        logger.debug({ msg: "Copying folder", folderPath: result.folderPath, targetDir });
        const copyResult = await copyPathToWorkspace(result.folderPath, targetDir, {
          conflictResolution: 'prompt',
        });

        if (copyResult.success) {
          logger.debug({ msg: "Folder copied successfully" });
          // Refresh file tree after copying
          try {
            await reloadExplorer(workspacePath, { preserveNavigation: true });
            logger.debug({ msg: "File tree refreshed after adding folder" });
          } catch (error) {
            logger.error({ msg: "Failed to refresh file tree:", err: error });
          }
        } else {
          logger.error({ msg: "Failed to copy folder:", err: copyResult.error });
        }
      } catch (error) {
        logger.error({ msg: "Error copying folder:", err: error });
      }
    } catch (error) {
      logger.error({ msg: "Error in handleAddFolder:", err: error });
    }
  }, [readOnly, workspacePath, directoryStack, reloadExplorer]);

  // ========== Paste to Knowledge Base feature ==========

  // Open paste dialog - use global context
  const handleOpenPasteDialog = useCallback(() => {
    if (readOnly || !workspacePath) {
      return;
    }
    // Determine target directory (current browsing directory or root)
    const targetDir = directoryStack.length > 0
      ? directoryStack[directoryStack.length - 1].path
      : workspacePath;

    openPasteDialog(workspacePath, targetDir, () => {
      // Success callback: refresh file tree
      void reloadExplorer(workspacePath, { preserveNavigation: true }).catch(error => {
        logger.error({ msg: "Failed to refresh file tree after paste:", err: error });
      });
    });
  }, [readOnly, workspacePath, directoryStack, openPasteDialog, reloadExplorer]);

  // ========== Clear Current Folder feature ==========

  // Handle clearing all items in the current directory
  const handleClearCurrentFolder = useCallback(async () => {
    if (readOnly || currentItems.length === 0) {
      return;
    }

    const pathsToDelete = currentItems.map(item => item.path);
    const itemCount = pathsToDelete.length;

    // Use system confirmation dialog
    const confirmMessage = `Are you sure you want to clear all ${itemCount} items in the current folder?\n\nThis action cannot be undone.`;

    const confirmed = window.confirm(confirmMessage);

    if (!confirmed) {
      return;
    }

    logger.debug({ msg: "Clearing current folder, paths:", data: pathsToDelete });

    try {
      const result = await fsApi.deletePaths(pathsToDelete);

      logger.debug({ msg: "Clear result:", data: result });

      if (result?.successCount && result.successCount > 0) {
        // Refresh file tree
        try {
          await reloadExplorer(workspacePath, { preserveNavigation: true });
          logger.debug({ msg: "File tree refreshed after clearing folder" });
        } catch (error) {
          logger.error({ msg: "Failed to refresh file tree:", err: error });
        }
      }

      if (result?.failCount && result.failCount > 0) {
        logger.error({ msg: "Some deletions failed:", data: result.results?.filter((r: any) => !r.success) });
      }
    } catch (error) {
      logger.error({ msg: "Error clearing folder:", err: error });
    }
  }, [readOnly, currentItems, workspacePath, reloadExplorer]);

  // ========== Item context menu (... button) ==========

  // Handle opening context menu for a file/folder item via the global FileTreeNodeContextMenu in AgentLayout
  const fileTreeNodeMenuActions = FileTreeNodeMenuAtom.useChange();
  const handleItemMoreMenu = useCallback((e: React.MouseEvent, item: { path: string; name: string; isDirectory: boolean }) => {
    e.stopPropagation();
    e.preventDefault();

    // Dispatch to AgentLayout's FileTreeNodeContextMenu via custom event
    const node = {
      name: item.name,
      path: item.path,
      type: item.isDirectory ? 'directory' : 'file',
    };
    fileTreeNodeMenuActions.open(e.clientX, e.clientY, node, workspacePath);
  }, [workspacePath]);

  // Get empty state message
  const getEmptyStateMessage = useCallback(() => {
    const agentName = agentData?.name || 'Agent';

    return {
      title: 'Add documents, code files, images, and more.',
      subtitle: `${agentName} can use them as references when you chat.`
    };
  }, [agentData?.name]);

  const emptyMessage = getEmptyStateMessage();

  const breadcrumbParts = getBreadcrumbParts();

  return (
    <div
      className={`relative flex h-full min-h-0 flex-col ${isDraggingOver ? 'bg-neutral-500/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop Overlay */}
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-neutral-500/10">
          <div className="rounded-xl border-2 border-dashed border-neutral-500 bg-surface-primary/90 p-8 text-center shadow-lg backdrop-blur-sm">
            <div className="mb-4 animate-bounce text-6xl">📁</div>
            <p className="m-0 text-lg font-medium text-neutral-500">Drop files or folders here to add to Knowledge Base</p>
          </div>
        </div>
      )}

      {/* Tab Body */}
      <div className="flex h-full min-h-0 flex-1 flex-col gap-5 overflow-hidden">
        {isValidWorkspacePath(workspacePath) ? (
          <div
            className={`flex h-full flex-initial flex-col ${isDraggingOver ? 'rounded-xl outline-dashed outline-2 outline-neutral-500/50' : ''
              }`}
          >
            {/* Header */}
            {directoryStack.length > 0 && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
                <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 shrink-0"
                    onClick={handleBack}
                    title="Go back"
                  >
                    <ChevronLeft size={18} strokeWidth={2} />
                  </Button>
                  <div className="flex flex-wrap items-center gap-1 overflow-hidden">
                    {breadcrumbParts.map((part, index, arr) => (
                      <React.Fragment key={part.path}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-auto px-2 py-1 text-sm ${index === arr.length - 1
                            ? 'font-semibold text-content-heading'
                            : 'font-medium text-content-secondary'
                            }`}
                          onClick={() => handleBreadcrumbClick(index)}
                          disabled={index === arr.length - 1}
                        >
                          {part.name}
                        </Button>
                        {index < arr.length - 1 && (
                          <span className="text-content-tertiary">/</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Content: file and directory list */}
            <div className="flex-1 overflow-y-auto p-4 pb-3">
              {isLoading ? (
                <LoadingSpinner />
              ) : currentItems.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {currentItems.map((item) => (
                    <div
                      key={item.path}
                      className="group flex cursor-pointer items-center gap-3 rounded border border-border bg-surface-primary px-4 py-3 transition-colors hover:bg-surface-secondary"
                      onClick={() => item.isDirectory ? handleDirectoryClick(item) : handleFileClick(item)}
                    >
                      <div className="flex shrink-0 items-center justify-center text-content-secondary">
                        {item.isDirectory ? (
                          <Folder size={16} />
                        ) : (
                          <FileIcon extension={item.extension} fileName={item.name} />
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="flex-1 break-words text-sm font-semibold text-content-heading">{item.name}</span>
                        {item.isFile && (
                          <span className="shrink-0 text-xs text-content-tertiary">
                            {formatFileSize(item.size)}
                          </span>
                        )}
                      </div>
                      {/* More options button - triggers context menu via AgentLayout */}
                      {!readOnly && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-7 shrink-0 text-content-tertiary"
                          onClick={(e) => handleItemMoreMenu(e, item)}
                          title="More options"
                        >
                          <MoreHorizontal size={16} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* Empty folder state */
                <div className="flex h-full items-center justify-center">
                  <div className="flex max-w-[480px] flex-col items-center gap-2 p-6 text-center">
                    <div className="mb-1 text-content-tertiary">
                      <FolderOpen size={40} />
                    </div>
                    <p className="m-0 text-lg font-semibold text-content-heading">{emptyMessage.title}</p>
                    <p className="m-0 text-base text-content-secondary">{emptyMessage.subtitle}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer toolbar: breadcrumb navigation (when nested) + actions */}
            {!readOnly && (
              <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2">
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {currentItems.length > 0 && (
                    <Button
                      size="sm"
                      className="gap-1.5 border border-red-500/30 bg-red-500/[0.08] text-red-600 hover:border-red-500/50 hover:bg-red-500/15 hover:text-red-600"
                      onClick={handleClearCurrentFolder}
                      title="Clear all items in current folder"
                    >
                      <Trash2 size={16} />
                      <span>Clear</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleAddFiles}
                    title="Add files"
                  >
                    <File size={16} />
                    <span>Add Files</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleAddFolder}
                    title="Add folder"
                  >
                    <FolderPlus size={16} />
                    <span>Add Folder</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleOpenPasteDialog}
                    title="Paste text"
                  >
                    <Clipboard size={16} />
                    <span>Paste Text</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <LoadingSpinner />
        )}
      </div>
    </div>
  );
};

export default AgentKnowledgeBaseTab;
