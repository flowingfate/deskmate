import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, FolderOpen, MoreHorizontal, File, FolderPlus, Clipboard, ChevronDown, ChevronRight } from 'lucide-react';
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
  workspaceOps
} from '../../../lib/chat/workspaceOps';
import { fsApi } from '@/ipc/fs';
import { workspaceApi } from '@/ipc/workspace';
import { tryResolveUriToPath } from '@/lib/internalUrls';
import { Button } from '@/shadcn/button';

// Shared ignore directory patterns
const IGNORE_PATTERNS = [
  'node_modules', '.git', 'dist', 'build', '.next',
  'out', 'coverage', '.vscode', '.idea'
];
import FileTreeExplorer from './FileTreeExplorer';
import { usePasteToWorkspace } from './PasteToWorkspaceProvider';
import { WorkspaceMenuActions } from './WorkspaceExplorerSidepane';
import { cn } from '@renderer/lib/utilities';

// Image file extensions set
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp', 'ico', 'tiff', 'tif']);
const isImageFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
};

interface FileExplorerSectionProps {
  title: string;
  className?: string;
  /**
   * URI of the root to browse — 统一用 URI 抽象(`knowledge://` / `local://`);
   * 内部用 `resolveUriToPath` 翻成绝对路径再喂给老 fs IPC。空字符串 = 没东西
   * 可显示(空 state)。也接受绝对路径形态以兼容内部传统调用,但新代码应只
   * 传 URI。
   */
  rootUri: string;
  currentAgentId: string | null;
  currentChatSessionId: string | null;
  revealRequest?: {
    path: string;
    nonce: number;
  } | null;
  onRevealHandled?: () => void;
  onMenuToggle?: (buttonElement: HTMLElement, menuActions: WorkspaceMenuActions) => void;
  /** System-managed directory: hide manual add/paste actions in empty state and menu */
  readOnly?: boolean;
  /** Custom message shown when the directory is empty */
  emptyMessage?: string;
}

const FileExplorerSection: React.FC<FileExplorerSectionProps> = ({
  title,
  className,
  rootUri,
  currentAgentId,
  currentChatSessionId,
  revealRequest,
  onRevealHandled,
  onMenuToggle,
  emptyMessage,
  readOnly,
}) => {
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Paste to Workspace - using global context
  const { openPasteDialog } = usePasteToWorkspace();

  // Current browsing directory path stack
  const [directoryStack, setDirectoryStack] = useState<FileTreeNode[]>([]);

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const watchStartedRef = useRef(false);
  const fileChangeListenerRef = useRef<(() => void) | null>(null);
  // Subdirectory lazy loading cache: key = directory absolute path, value = true means loaded
  const childrenCache = useRef<Map<string, true>>(new Map());

  // Deeply inject child nodes into directory node at specified path in tree
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

  // Lazy load child nodes: called when user expands directory
  const handleLoadChildren = useCallback(async (dirPath: string) => {
    if (childrenCache.current.has(dirPath)) return;
    try {
      const result = await getDirectoryChildren(dirPath, { ignorePatterns: IGNORE_PATTERNS });
      const children = result.success ? (result.data?.children as FileTreeNode[] || []) : [];
      childrenCache.current.set(dirPath, true);
      setFileTree(prev => injectChildren(prev, dirPath, children));
    } catch (error) { /* ignore */ }
  }, [injectChildren]);



  // 解析 rootUri → workspacePath 绝对路径。`knowledge://` / `local://` 走
  // resolveUriToPath IPC(由 ProtocolHandler 决定 sandbox 根);非 URI 直接透传。
  // agentId / sessionId 缺失走 tryResolve 静默退化 = 空 state。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = !rootUri
        ? ''
        : await tryResolveUriToPath(rootUri, {
            agentId: currentAgentId,
            chatSessionId: currentChatSessionId,
          });
      if (!cancelled && resolved !== workspacePath) {
        setWorkspacePath(resolved);
      }
    })();
    return () => { cancelled = true; };
  }, [rootUri, currentAgentId, currentChatSessionId]);
  // Load file tree (only load direct children of root directory)
  const loadFileTree = useCallback(async (path: string) => {
    if (!path || path.trim() === '') {
      setFileTree([]);
      return;
    }

    setIsLoading(true);
    try {
      const result = await getWorkspaceFileTree(path, {
        maxDepth: 1,
        ignorePatterns: IGNORE_PATTERNS
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to load file tree');
      }

      const treeData = result.data as FileTreeData;
      setFileTree(treeData.tree || []);
    } catch (error) {
      setFileTree([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reloadRootTree = useCallback(async (path: string, options?: { clearAllCaches?: boolean }) => {
    childrenCache.current.clear();
    try {
      if (options?.clearAllCaches) {
        await clearFileTreeCache();
      } else {
        await clearFileTreeCache(path);
      }
    } catch (error) { /* ignore */ }
    await loadFileTree(path);
  }, [loadFileTree]);

  // Load file tree when workspacePath changes
  useEffect(() => {
    if (isValidWorkspacePath(workspacePath)) {
      void reloadRootTree(workspacePath);
    } else {
      childrenCache.current.clear();
      setFileTree([]);
    }
  }, [workspacePath, reloadRootTree]);

  // Handle refresh button click (restore previously expanded directories after refresh)
  const handleRefresh = useCallback(async () => {
    if (isValidWorkspacePath(workspacePath)) {
      // Read currently expanded directory list, restore after refresh
      const storageKey = `fileTree_expanded_${workspacePath}`;
      let prevExpanded: string[] = [];
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) prevExpanded = JSON.parse(saved) as string[];
      } catch { /* ignore */ }
      // Sort by path depth to ensure parent directories load before subdirectories
      prevExpanded.sort((a, b) => a.split('/').length - b.split('/').length);

      await reloadRootTree(workspacePath, { clearAllCaches: true });

      // Sequentially reload child nodes of previously expanded directories
      for (const dirPath of prevExpanded) {
        await handleLoadChildren(dirPath);
      }
    }
  }, [workspacePath, reloadRootTree, handleLoadChildren]);

  useEffect(() => {
    if (!revealRequest || revealRequest.path !== workspacePath) {
      return;
    }

    setIsCollapsed(false);
    handleRefresh().finally(() => {
      onRevealHandled?.();
    });
  }, [handleRefresh, onRevealHandled, revealRequest, workspacePath]);

  // ========== File watching feature ==========

  // Handle file change events - clear lazy loading cache and reload, while restoring expanded state
  const handleFileChanges = useCallback(async () => {
    if (isValidWorkspacePath(workspacePath)) {
      // Read currently expanded directory list, restore after refresh
      const storageKey = `fileTree_expanded_${workspacePath}`;
      let prevExpanded: string[] = [];
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) prevExpanded = JSON.parse(saved) as string[];
      } catch { /* ignore */ }
      prevExpanded.sort((a, b) => a.split('/').length - b.split('/').length);

      await reloadRootTree(workspacePath, { clearAllCaches: true });

      // Sequentially reload child nodes of previously expanded directories
      for (const dirPath of prevExpanded) {
        await handleLoadChildren(dirPath);
      }
    }
  }, [workspacePath, reloadRootTree, handleLoadChildren]);

  // Start file watching
  const startFileWatcher = useCallback(async (path: string) => {
    if (!path || !isValidWorkspacePath(path)) return;
    if (watchStartedRef.current) return;

    try {
      // Remove old listener
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }

      // Add refresh listener
      const removeListener = workspaceOps.onRefresh(handleFileChanges);
      fileChangeListenerRef.current = removeListener;

      // Start backend file watching
      const result = await startWatch(path, {
        excludes: [
          'node_modules', '.git', 'dist', 'build', '.next',
          'out', 'coverage', '.vscode', '.idea', '.DS_Store', 'Thumbs.db'
        ]
      });

      if (result.success) {
        watchStartedRef.current = true;
      }
    } catch (error) { /* ignore */ }
  }, [handleFileChanges]);

  // Stop file watching
  const stopFileWatcher = useCallback(async () => {
    if (!watchStartedRef.current) return;

    try {
      if (fileChangeListenerRef.current) {
        fileChangeListenerRef.current();
        fileChangeListenerRef.current = null;
      }
      await stopWatch();
      watchStartedRef.current = false;
    } catch (error) { /* ignore */ }
  }, []);

  // Restart file watching when workspacePath changes
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



  // Open in system file explorer
  const handleOpenInExplorer = useCallback(async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (!isValidWorkspacePath(workspacePath)) return;
    try {
      await openInSystemExplorer(workspacePath);
    } catch (error) { /* ignore */ }
  }, [workspacePath]);



  // Handle file click
  const handleFileClick = useCallback((node: FileTreeNode) => {
    if (isImageFile(node.name)) {
      window.dispatchEvent(new CustomEvent('imageViewer:open', {
        detail: {
          images: [{ id: node.path, url: `file://${node.path}`, alt: node.name }],
          initialIndex: 0,
        },
      }));
    } else {
      window.dispatchEvent(new CustomEvent('fileViewer:open', {
        detail: {
          file: { name: node.name, url: node.path },
        },
      }));
    }
  }, []);

  // Drag and drop handling
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (!isValidWorkspacePath(workspacePath)) return;

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const sourcePaths: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let sourcePath: string | undefined;

      if (window.electronAPI?.fs?.getPathForFile) {
        try {
          sourcePath = window.electronAPI.fs.getPathForFile(file);
        } catch (err) { /* ignore */ }
      }
      if (!sourcePath && (file as any).path) {
        sourcePath = (file as any).path;
      }
      if (!sourcePath) continue;

      sourcePaths.push(sourcePath);
    }

    if (sourcePaths.length === 0) return;

    let successCount = 0;
    try {
      const result = await copyPathsToWorkspace(sourcePaths, workspacePath, {
        conflictResolution: 'prompt',
      });
      successCount = result.data?.successCount ?? 0;
    } catch (error) { /* ignore */ }

    if (successCount > 0) {
      try {
        await reloadRootTree(workspacePath);
      } catch (error) { /* ignore */ }
    }
  }, [workspacePath, reloadRootTree]);

  // Build file tree (with path safety validation)
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

    const validatedFileTree = fileTree.length > 0 ? filterValidNodes(fileTree) : [];

    // Return root directory contents directly, hide root node
    return validatedFileTree;
  }, [workspacePath, fileTree]);

  // Check if empty
  const isEmpty = useMemo(() => {
    return isValidWorkspacePath(workspacePath) && fileTree.length === 0;
  }, [workspacePath, fileTree]);

  // Handle add files
  const handleAddFiles = useCallback(async () => {
    if (!isValidWorkspacePath(workspacePath)) return;

    try {
      const result = await fsApi.selectFiles({
        title: 'Select Files or Folders to Add',
        allowMultiple: true,
      });

      if (!result?.success || !result.filePaths || result.filePaths.length === 0) return;

      let successCount = 0;
      try {
        const copyResult = await copyPathsToWorkspace(result.filePaths, workspacePath, {
          conflictResolution: 'prompt',
        });
        successCount = copyResult.data?.successCount ?? 0;
      } catch (error) { /* ignore */ }

      if (successCount > 0) {
        try {
          await reloadRootTree(workspacePath);
        } catch (error) { /* ignore */ }
      }
    } catch (error) { /* ignore */ }
  }, [workspacePath, reloadRootTree]);

  // Handle add folder
  const handleAddFolder = useCallback(async () => {
    if (!isValidWorkspacePath(workspacePath)) return;

    try {
      const result = await workspaceApi.selectFolder();
      if (!result?.success || !result.folderPath) return;

      const copyResult = await copyPathToWorkspace(result.folderPath, workspacePath, {
        conflictResolution: 'prompt',
      });
      if (copyResult.success) {
        try {
          await reloadRootTree(workspacePath);
        } catch (error) { /* ignore */ }
      }
    } catch (error) { /* ignore */ }
  }, [workspacePath, reloadRootTree]);

  // Handle paste
  const handleOpenPasteDialog = useCallback(() => {
    if (!isValidWorkspacePath(workspacePath)) return;
    openPasteDialog(workspacePath, workspacePath, () => {
      void reloadRootTree(workspacePath);
    });
  }, [workspacePath, openPasteDialog, reloadRootTree]);

  // Handle menu toggle
  const handleMenuToggle = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();

    if (menuButtonRef.current && onMenuToggle) {
      const menuActions: WorkspaceMenuActions = {
        onOpenInExplorer: handleOpenInExplorer,
        onAddFiles: handleAddFiles,
        onAddFolder: handleAddFolder,
        onPasteToWorkspace: handleOpenPasteDialog,
        canOpenInExplorer: isValidWorkspacePath(workspacePath),
        canAddFiles: isValidWorkspacePath(workspacePath) && !readOnly,
        canAddFolder: isValidWorkspacePath(workspacePath) && !readOnly,
        canPasteToWorkspace: isValidWorkspacePath(workspacePath) && !readOnly,
        workspacePath,
      };

      onMenuToggle(menuButtonRef.current, menuActions);
    }
  }, [onMenuToggle, workspacePath, handleOpenInExplorer, handleAddFiles, handleAddFolder, handleOpenPasteDialog, currentAgentId, readOnly]);

  // Get empty state message
  const getEmptyStateMessage = useCallback(() => {
    return {
      title: 'Add documents, code files, images, and more.',
      subtitle: `Drag and drop files to add them here.`
    };
  }, [title]);

  // Toggle collapse state
  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

  // Auto-restore expanded directory content (on first load/sidepane remount)
  useEffect(() => {
    if (!isLoading && fileTree.length > 0 && isValidWorkspacePath(workspacePath)) {
      const storageKey = `fileTree_expanded_${workspacePath}`;
      let prevExpanded: string[] = [];
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) prevExpanded = JSON.parse(saved) as string[];
      } catch { /* ignore */ }
      prevExpanded.sort((a, b) => a.split('/').length - b.split('/').length);
      // Only load expanded directories not yet cached
      prevExpanded.forEach(dirPath => {
        if (!childrenCache.current.has(dirPath)) {
          handleLoadChildren(dirPath);
        }
      });
    }
    // Only trigger on fileTree or workspacePath changes
  }, [fileTree, workspacePath, isLoading]);

  return (
    <div
      className={cn('file-explorer-section', className, isDraggingOver && 'dragging-over', isCollapsed && 'collapsed')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Section Header */}
      <div className="sidepane-section-header" onClick={handleToggleCollapse}>
        <div className="sidepane-section-header-title">
          <span className="sidepane-section-collapse-icon">
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <span className="sidepane-section-title-text">{title}</span>
        </div>
        <div className="sidepane-section-header-actions" onClick={(e) => e.stopPropagation()}>
          {!isCollapsed && isValidWorkspacePath(workspacePath) && (
            <Button
              variant="ghost"
              size="icon"
              className="sidepane-action-btn"
              onClick={handleRefresh}
              disabled={isLoading}
              title={`Refresh ${title} file tree`}
            >
              <RefreshCw size={14} />
            </Button>
          )}

          {!isCollapsed && (
            <Button
              ref={menuButtonRef}
              variant="ghost"
              size="icon"
              className="sidepane-action-btn"
              onClick={handleMenuToggle}
              disabled={!currentAgentId || !isValidWorkspacePath(workspacePath)}
              title="More options"
            >
              <MoreHorizontal size={14} />
            </Button>
          )}

        </div>
      </div>

      {/* Section Body */}
      {!isCollapsed && (
        <div className="sidepane-section-body">
          {isDraggingOver && (
            <div className="drop-overlay">
              <div className="drop-overlay-content">
                <div className="drop-icon">📁</div>
                <p>Drop files or folders here to copy to {title}</p>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="loading-state">
              <div className="loading-spinner">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <g clipPath="url(#clip0_section)">
                    <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
                    <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
                  </g>
                  <defs>
                    <clipPath id="clip0_section">
                      <rect width="20" height="20" fill="white"/>
                    </clipPath>
                  </defs>
                </svg>
              </div>
              <p>Loading {title.toLowerCase()}...</p>
            </div>
          ) : !isValidWorkspacePath(workspacePath) ? (
            <div className="empty-state">
              <div className="empty-icon">📂</div>
              <p>Default {title.toLowerCase()} for this chat</p>
              <small style={{ fontSize: '0.85em', color: '#888', marginTop: '8px', display: 'block' }}>
                Path: {workspacePath || 'Not initialized'}
              </small>
            </div>
          ) : isEmpty ? (
            <div className="sidepane-workspace-empty-state">
              <div className="sidepane-workspace-empty-content">
                <div className="sidepane-workspace-empty-icon">
                  <FolderOpen size={48} />
                </div>
                <p className="sidepane-workspace-empty-text">{emptyMessage || getEmptyStateMessage().title}</p>
                {!emptyMessage && <p className="sidepane-workspace-empty-subtext">{getEmptyStateMessage().subtitle}</p>}
                {!readOnly && (
                  <div className="sidepane-workspace-empty-actions">
                    <Button variant="default" size="sm" onClick={handleAddFiles}>
                      <File size={16} />
                      <span>Add Files</span>
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleAddFolder}>
                      <FolderPlus size={16} />
                      <span>Add Folder</span>
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleOpenPasteDialog}>
                      <Clipboard size={16} />
                      <span>Paste Text</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <FileTreeExplorer
              nodes={fileTreeWithRoot}
              workspacePath={workspacePath}
              onFileClick={handleFileClick}
              className="workspace-file-tree"
              directoryStack={directoryStack}
              onDirectoryStackChange={setDirectoryStack}
              showBreadcrumb={false}
              onLoadChildren={handleLoadChildren}
            />
          )}
        </div>
      )}

    </div>
  );
};

export default FileExplorerSection;
