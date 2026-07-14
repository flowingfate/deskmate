import React, { createElement } from 'react';
import { FolderOpen, ExternalLink, Trash2, Copy, Download, ArrowRightToLine } from 'lucide-react';
import { fsApi } from '@/ipc/fs';
import { workspaceApi } from '@/ipc/workspace';
import { CurrentSessionStatus } from '../../lib/chat/agentSessionCacheManager';
import { shouldShowAddToKnowledgeBaseOption } from '../../lib/chat/addToKnowledgeBase';
import { isInstallableSkillArtifact } from '../../lib/skills/installableSkillArtifacts';
import { atom } from '@/atom';
import { log } from '@/log';
import { type FileTreeNode, workspaceOps } from '@renderer/lib/chat/workspaceOps';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shadcn/dropdown-menu';
const logger = log.child({ mod: 'FileTreeNodeContextMenu' });
import { requestConfirmation } from '@/components/ui/ConfirmationDialog';

const zeroState: {
  isOpen: boolean;
  position: { top: number; left: number } | null;
  node: FileTreeNode | null;
  workspacePath: string | null;
  canDelete: boolean;
} = { isOpen: false, position: null, node: null, workspacePath: null, canDelete: false };

export const FileTreeNodeMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function open(clientX: number, clientY: number, node: FileTreeNode, workspacePath: string, canDelete = true) {
    set({ isOpen: true, position: { top: clientY, left: clientX }, node, workspacePath, canDelete });
  }

  async function remove() {
    const { workspacePath } = get();
    // Clear cache to ensure reload on next fetch
    if (workspacePath) {
      await workspaceOps.clearFileTreeCache(workspacePath);
    }
    // Actively notify all FileExplorerSections to refresh, without relying on file watcher auto-detection
    workspaceOps.triggerRefresh();
  }

  return { open, close, remove };
});

interface MenuProps {
  onInstallSkill?: (filePath: string) => void;
  onAddToKnowledge?: (filePath: string) => void;
}

interface InnerProps extends MenuProps {
  position: { top: number; left: number };
  node: FileTreeNode;
  workspacePath: string;
  canDelete: boolean;
}

const FileTreeNodeContextMenu: React.FC<InnerProps> = ({
  onInstallSkill,
  onAddToKnowledge,
  position,
  node,
  workspacePath,
  canDelete,
}) => {
  const { close: onClose, remove: onRemove } = FileTreeNodeMenuAtom.useChange();
  const { chatStatus } = CurrentSessionStatus.use();

  const platform = window.electronAPI?.platform || 'darwin';
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  const fullPath = node.path;

  const handleOpen = React.useCallback(async () => {
    try {
      const result = await workspaceApi.openPath(fullPath);
      if (!result?.success) {
        logger.error({ msg: "Failed to open file:", err: result?.error });
      }
    } catch (error) {
      logger.error({ msg: "Error opening file:", err: error });
    }
  }, [fullPath]);

  const handleShowInFolder = React.useCallback(async () => {
    try {
      const result = await workspaceApi.showInFolder(fullPath);
      if (!result?.success) {
        logger.error({ msg: "Failed to show in folder:", err: result?.error });
      }
    } catch (error) {
      logger.error({ msg: "Error showing in folder:", err: error });
    }
  }, [fullPath]);

  const handleDelete = React.useCallback(async () => {
    const itemName = node.name || fullPath.split(/[/\\]/).pop();
    const itemType = node.type === 'directory' ? 'folder' : 'file';

    const confirmed = await requestConfirmation({
      title: `Delete ${itemType}?`,
      description: `Are you sure you want to delete this ${itemType}? ${itemName} This action cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });

    if (!confirmed) {
      return;
    }

    try {
      logger.debug({ msg: "Deleting path:", data: fullPath });
      const result = await fsApi.deletePaths([fullPath]);
      logger.debug({ msg: "Delete result:", data: result });

      if (!result?.success) {
        let errorMsg = result?.error || 'Unknown error';
        if (result?.results && result.results.length > 0) {
          const failedResult = result.results.find((item) => !item.success);
          if (failedResult?.error) {
            errorMsg = failedResult.error;
          }
        }
        logger.error({ msg: "Failed to delete:", err: errorMsg });
        window.alert(`Failed to delete ${itemType}: ${errorMsg}`);
      } else {
        onRemove();
      }
    } catch (error) {
      logger.error({ msg: "Error deleting:", err: error });
      window.alert(`Failed to delete ${itemType}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [fullPath, node, onRemove]);

  const handleCopyPath = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullPath);
    } catch (error) {
      logger.error({ msg: "Failed to copy path:", err: error });
    }
  }, [fullPath]);

  const getRevealInFolderText = () => {
    if (isWindows) {
      return 'Reveal in File Explorer';
    } else if (isMac) {
      return 'Reveal in Finder';
    } else {
      return 'Reveal in File Manager';
    }
  };

  const getOpenMenuText = () => {
    if (node.type === 'file') {
      return 'Open with Default App';
    } else {
      if (isWindows) {
        return 'Open in File Explorer';
      } else if (isMac) {
        return 'Open in Finder';
      } else {
        return 'Open in File Manager';
      }
    }
  };

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: 'fixed',
            top: position.top,
            left: position.left,
            width: 0,
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0}>
        {node.type === 'file' ? (
          <DropdownMenuItem onClick={handleOpen}>
            <ExternalLink size={16} strokeWidth={1.5} />
            {getOpenMenuText()}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={handleShowInFolder}>
            <FolderOpen size={16} strokeWidth={1.5} />
            {getOpenMenuText()}
          </DropdownMenuItem>
        )}

        {node.type === 'file' && (
          <DropdownMenuItem onClick={handleShowInFolder}>
            <FolderOpen size={16} strokeWidth={1.5} />
            {getRevealInFolderText()}
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={handleCopyPath}>
          <Copy size={16} strokeWidth={1.5} />
          Copy Path
        </DropdownMenuItem>

        {node.type === 'file' && onAddToKnowledge && shouldShowAddToKnowledgeBaseOption(fullPath, !chatStatus || chatStatus === 'idle') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { onAddToKnowledge(fullPath); }}>
              <ArrowRightToLine size={16} strokeWidth={1.5} />
              Add to Agent Knowledge
            </DropdownMenuItem>
          </>
        )}

        {node.type === 'file' && isInstallableSkillArtifact(fullPath) && onInstallSkill && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { onInstallSkill(fullPath); }}>
              <Download size={16} strokeWidth={1.5} />
              Install skill
            </DropdownMenuItem>
          </>
        )}

        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleDelete}>
              <Trash2 size={16} strokeWidth={1.5} />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default (props: MenuProps) => {
  const [{ isOpen, position, node, workspacePath, canDelete }] = FileTreeNodeMenuAtom.use();
  if (!isOpen || !position || !node || !workspacePath) return null;
  return createElement(FileTreeNodeContextMenu, { ...props, position, node, workspacePath, canDelete });

};
