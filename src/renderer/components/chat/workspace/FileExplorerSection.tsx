import React from 'react';
import { RefreshCw, MoreHorizontal, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { cn } from '@renderer/lib/utilities';
import FileTreeExplorer from './FileTreeExplorer';
import { AnimatedSectionBody } from './AnimatedSectionBody';
import { WorkspaceMenuActions } from './WorkspaceExplorerSidepane';
import { useFileExplorerSection } from './useFileExplorerSection';
import {
  DropOverlay,
  LoadingState,
  UninitializedState,
  EmptyState,
} from './FileExplorerSectionStates';

interface FileExplorerSectionProps {
  title: string;
  className?: string;
  /**
   * 要浏览的根 URI —— 统一用 URI 抽象（`knowledge://` / `local://`）；
   * 内部用 `resolveUriToPath` 翻成绝对路径再喂给老 fs IPC。空字符串 = 没东西
   * 可显示（空 state）。也接受绝对路径形态以兼容内部传统调用，但新代码应只传 URI。
   */
  rootUri: string;
  currentAgentId: string | null;
  currentChatSessionId: string | null;
  revealRequest?: { path: string; nonce: number } | null;
  onRevealHandled?: () => void;
  onMenuToggle?: (buttonElement: HTMLElement, menuActions: WorkspaceMenuActions) => void;
  /** 系统托管目录：空 state 与菜单中隐藏手动添加 / 粘贴动作 */
  readOnly?: boolean;
  /** 目录为空时展示的自定义提示 */
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
  const {
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
  } = useFileExplorerSection({
    rootUri,
    currentAgentId,
    currentChatSessionId,
    readOnly,
    revealRequest,
    onRevealHandled,
    onMenuToggle,
  });

  return (
    <div
      className={cn(
        'relative flex flex-col gap-0.5 w-full',
        isDraggingOver && 'rounded-xl bg-blue-500/5 outline outline-dashed outline-blue-500/50 -outline-offset-2',
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Section Header */}
      <div
        className="group/header box-border flex justify-between items-center self-stretch flex-none h-11 px-3 gap-2 cursor-pointer select-none transition-colors bg-surface-subtle"
        onClick={handleToggleCollapse}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="flex items-center justify-center shrink-0 text-content-tertiary transition-transform">
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          <span className="truncate text-[13px] font-semibold tracking-tight text-content-heading">{title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!isCollapsed && isValid && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md text-content-tertiary hover:text-content-heading hover:bg-surface-subtle"
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
              className="h-7 w-7 rounded-md text-content-tertiary hover:text-content-heading hover:bg-surface-subtle"
              onClick={handleMenuToggle}
              disabled={!currentAgentId || !isValid}
              title="More options"
            >
              <MoreHorizontal size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Section Body */}
      {!isCollapsed && (
        <div className="relative w-full">
          {isDraggingOver && <DropOverlay title={title} />}
          <AnimatedSectionBody>
            {isLoading ? (
              <LoadingState title={title} />
            ) : !isValid ? (
              <UninitializedState title={title} />
            ) : isEmpty ? (
              <EmptyState
                emptyMessage={emptyMessage}
                readOnly={readOnly}
                onAddFiles={handleAddFiles}
                onAddFolder={handleAddFolder}
                onOpenPaste={handleOpenPasteDialog}
              />
            ) : (
              <FileTreeExplorer
                nodes={fileTreeWithRoot}
                workspacePath={workspacePath}
                onFileClick={handleFileClick}
                onLoadChildren={handleLoadChildren}
              />
            )}
          </AnimatedSectionBody>
        </div>
      )}
    </div>
  );
};

export default FileExplorerSection;
