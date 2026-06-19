import React, { useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { FileTreeNode } from '../../../lib/chat/workspaceOps';
import { workspaceApi } from '@/ipc/workspace';
import { FileTreeNodeMenuAtom } from '../../menu/FileTreeNodeContextMenu';
import { getFileTreeIcon } from './fileTreeIcons';
import { log } from '@/log';

const logger = log.child({ mod: 'FileTreeNodeItem' });

export interface FileTreeNodeItemProps {
  node: FileTreeNode;
  workspacePath: string;
  level?: number;
  onFileClick?: (node: FileTreeNode) => void;
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
    fileTreeNodeMenuActions.open(e.clientX, e.clientY, node, workspacePath);
  }, [node, workspacePath, fileTreeNodeMenuActions]);

  return (
    <>
      <div className="relative min-w-max" style={{ paddingLeft: `${level * 16 + 4}px` }}>
        <div
          className="group/row box-border flex items-center gap-1.5 h-8 pl-2 pr-3 self-stretch cursor-pointer rounded-lg transition-colors duration-150 hover:bg-black/[0.04] active:bg-black/[0.06] motion-reduce:transition-none"
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          title={node.path}
        >
          <span className="flex items-center justify-center shrink-0 w-4 text-content-tertiary transition-colors group-hover/row:text-content-secondary">
            {isDirectory
              ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
              : null}
          </span>
          <span className="inline-flex items-center justify-center shrink-0 w-4 leading-none text-content-tertiary">
            {getFileTreeIcon(node, isExpanded)}
          </span>
          <span className="flex-1 min-w-0 truncate text-[13px] font-medium leading-[1.4] text-content-heading">
            {node.name}
          </span>
        </div>
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
