import React, { useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { FileTreeNode } from '../../../lib/chat/workspaceOps';
import { workspaceApi } from '@/ipc/workspace';
import { FileTreeNodeMenuAtom } from '../../menu/FileTreeNodeContextMenu';
import { FileTreeIcon } from './fileTreeIcons';
import { formatFileSize } from '@/lib/utilities/contentUtils';
import { log } from '@/log';

const logger = log.child({ mod: 'FileTreeNodeItem' });

export interface FileTreeNodeItemProps {
  node: FileTreeNode;
  workspacePath: string;
  level?: number;
  onFileClick?: (node: FileTreeNode) => void;
  readOnly?: boolean;
  expandedDirs: Set<string>;
  onToggleExpand?: (path: string) => void;
  /** 懒加载回调：展开目录时调用，由父组件负责拉取并注入子节点 */
  onLoadChildren?: (dirPath: string) => Promise<void>;
}

/**
 * 单个文件 / 文件夹节点（Tree View）。
 * 目录点击切换展开并懒加载子节点；文件点击走 onFileClick，回退到系统打开。
 */
export const FileTreeNodeItem: React.FC<FileTreeNodeItemProps> = React.memo(({
  node,
  workspacePath,
  level = 0,
  onFileClick,
  readOnly,
  expandedDirs,
  onToggleExpand,
  onLoadChildren,
}) => {
  const isExpanded = expandedDirs.has(node.path);
  const isDirectory = node.type === 'directory';
  const hasChildren = isDirectory && !!node.children && node.children.length > 0;

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (node.type === 'file') {
      if (onFileClick) {
        onFileClick(node);
      } else {
        try {
          await workspaceApi.openPath(node.path);
        } catch (error) {
          logger.error({ msg: 'Error opening file:', err: error });
        }
      }
      return;
    }

    if (onToggleExpand) {
      const isCurrentlyExpanded = expandedDirs.has(node.path);
      onToggleExpand(node.path);
      if (!isCurrentlyExpanded && onLoadChildren) {
        await onLoadChildren(node.path);
      }
    }
  }, [node, onToggleExpand, onFileClick, expandedDirs, onLoadChildren]);

  const fileTreeNodeMenuActions = FileTreeNodeMenuAtom.useChange();

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fileTreeNodeMenuActions.open(e.clientX, e.clientY, node, workspacePath, !readOnly);
  }, [node, workspacePath, readOnly, fileTreeNodeMenuActions]);

  return (
    <>
      <div
        className="group/row relative box-border flex items-center h-8 pl-2 pr-2 cursor-pointer rounded-lg transition-colors duration-150 hover:bg-black/4 active:bg-black/6"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={node.path}
      >
        {/* 缩进引导线：每个祖先层级一条发丝竖线，跨行连续（VSCode 式层级引导） */}
        {Array.from({ length: level }).map((_, i) => (
          <span key={i} aria-hidden className="shrink-0 w-4 self-stretch flex justify-center">
            <span className="w-px self-stretch bg-border/60" />
          </span>
        ))}
        <span className="flex items-center justify-center shrink-0 w-4 text-content-tertiary transition-colors group-hover/row:text-content-secondary">
          {isDirectory
            ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
            : null}
        </span>
        <span className="inline-flex items-center justify-center shrink-0 w-4.5 h-4.5 ml-0.5 mr-1.5 leading-none">
          <FileTreeIcon node={node} isExpanded={isExpanded} />
        </span>
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium leading-[1.4] text-content-heading">
          {node.name}
        </span>
        {!isDirectory && node.size != null && (
          <span className="shrink-0 ml-2 text-[11px] tabular-nums text-content-tertiary opacity-0 transition-opacity group-hover/row:opacity-100">
            {formatFileSize(node.size)}
          </span>
        )}
      </div>

      {isDirectory && isExpanded && hasChildren && (
        <div className="flex flex-col">
          {node.children!.map((child) => (
            <FileTreeNodeItem
              key={child.path}
              node={child}
              workspacePath={workspacePath}
              level={level + 1}
              onFileClick={onFileClick}
              readOnly={readOnly}
              expandedDirs={expandedDirs}
              onToggleExpand={onToggleExpand}
              onLoadChildren={onLoadChildren}
            />
          ))}
        </div>
      )}
    </>
  );
});

FileTreeNodeItem.displayName = 'FileTreeNodeItem';
