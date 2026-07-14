import React, { useState, useCallback } from 'react';
import { FolderOpen } from 'lucide-react';
import { FileTreeNode } from '../../../lib/chat/workspaceOps';
import { FileTreeNodeItem } from './FileTreeNodeItem';
import { cn } from '@renderer/lib/utilities';
import { log } from '@/log';

const logger = log.child({ mod: 'FileTreeExplorer' });

export interface FileTreeExplorerProps {
  nodes: FileTreeNode[];
  workspacePath: string;
  onFileClick?: (node: FileTreeNode) => void;
  className?: string;
  readOnly?: boolean;
  /** 懒加载回调：展开目录时调用，父组件负责拉取并注入子节点 */
  onLoadChildren?: (dirPath: string) => Promise<void>;
}

/**
 * 文件树 Explorer：Tree View，支持多级目录展开 / 折叠。
 * 展开态持久化到 localStorage（按 workspacePath 分键）。
 */
const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  nodes,
  workspacePath,
  onFileClick,
  className,
  readOnly,
  onLoadChildren,
}) => {
  const storageKey = `fileTree_expanded_${workspacePath}`;

  // 从 localStorage 读取已保存的展开态
  const loadExpandedDirs = useCallback((): Set<string> => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return new Set(JSON.parse(saved) as string[]);
      }
    } catch (error) {
      logger.error({ msg: 'Failed to load expanded dirs:', err: error });
    }
    // 默认展开根目录（当根只有单个目录时）
    const initialExpanded = new Set<string>();
    if (nodes.length === 1 && nodes[0].type === 'directory') {
      initialExpanded.add(nodes[0].path);
    }
    return initialExpanded;
  }, [storageKey, nodes]);

  const saveExpandedDirs = useCallback((dirs: Set<string>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(dirs)));
    } catch (error) {
      logger.error({ msg: 'Failed to save expanded dirs:', err: error });
    }
  }, [storageKey]);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => loadExpandedDirs());

  // workspacePath 切换时从 localStorage 恢复展开态。
  // 注意：nodes 仅含浅层数据时不要回写裁剪，否则会误删深层展开记录。
  React.useEffect(() => {
    setExpandedDirs(loadExpandedDirs());
  }, [storageKey, loadExpandedDirs]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      saveExpandedDirs(next);
      return next;
    });
  }, [saveExpandedDirs]);

  if (!nodes || nodes.length === 0) {
    return (
      <div className={cn('flex flex-col w-full select-none', className)}>
        <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-surface-subtle border border-border-subtle">
            <FolderOpen size={22} strokeWidth={1.75} className="text-content-tertiary" />
          </div>
          <p className="m-0 text-xs font-medium text-content-secondary">This folder is empty or inaccessible</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col w-full select-none px-2 py-1.5', className)}>
      <div className="flex flex-col gap-px w-full">
        {nodes.map((node) => (
          <FileTreeNodeItem
            key={node.path}
            node={node}
            workspacePath={workspacePath}
            readOnly={readOnly}
            level={0}
            onFileClick={onFileClick}
            expandedDirs={expandedDirs}
            onToggleExpand={handleToggleExpand}
            onLoadChildren={onLoadChildren}
          />
        ))}
      </div>
    </div>
  );
};

export default FileTreeExplorer;
