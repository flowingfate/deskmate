import React, { createElement } from 'react';
import { FolderOpen, File, FolderPlus, Clipboard, Copy } from 'lucide-react';
import { WorkspaceMenuActions } from '../chat/workspace/WorkspaceExplorerSidepane';
import { atom } from '@/atom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shadcn/dropdown-menu';

const zeroMenuState: {
  isOpen: boolean;
  anchorElement: HTMLElement | null;
  actions: WorkspaceMenuActions | null;
} = { isOpen: false, anchorElement: null, actions: null };

export const WorkspaceMenuAtom = atom(zeroMenuState, (get, set) => {
  function close() {
    set(zeroMenuState);
  }

  function toggle(buttonElement: HTMLElement, actions: WorkspaceMenuActions) {
    const prevState = get();
    if (prevState.isOpen) {
      return set(zeroMenuState);
    }
    set({ isOpen: true, anchorElement: buttonElement, actions });
  }

  return { toggle, close };
});

interface InnerProps {
  anchorElement: HTMLElement;
  actions: WorkspaceMenuActions;
}

const WorkspaceMenuDropdown: React.FC<InnerProps> = ({ anchorElement, actions }) => {
  const { close: onClose } = WorkspaceMenuAtom.useChange();

  const anchorRect = anchorElement.getBoundingClientRect();

  const platform = window.electronAPI?.platform || 'darwin';
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  const getOpenInExplorerText = () => {
    if (isWindows) {
      return 'Open in File Explorer';
    } else if (isMac) {
      return 'Open in Finder';
    } else {
      return 'Open in File Manager';
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
            top: anchorRect.bottom,
            left: anchorRect.left,
            width: anchorRect.width,
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        {actions.canAddFiles && (
          <DropdownMenuItem onClick={() => actions.onAddFiles()}>
            <File size={16} strokeWidth={1.5} />
            <span>Add Files</span>
          </DropdownMenuItem>
        )}
        {actions.canAddFolder && (
          <DropdownMenuItem onClick={() => actions.onAddFolder()}>
            <FolderPlus size={16} strokeWidth={1.5} />
            <span>Add Folder</span>
          </DropdownMenuItem>
        )}
        {actions.canPasteToWorkspace && (
          <DropdownMenuItem onClick={() => actions.onPasteToWorkspace()}>
            <Clipboard size={16} strokeWidth={1.5} />
            <span>Paste Text</span>
          </DropdownMenuItem>
        )}
        {(actions.canAddFiles || actions.canAddFolder || actions.canPasteToWorkspace) &&
         actions.canOpenInExplorer && (
          <DropdownMenuSeparator />
        )}
        {actions.canOpenInExplorer && (
          <DropdownMenuItem onClick={() => actions.onOpenInExplorer()}>
            <FolderOpen size={16} strokeWidth={1.5} />
            <span>{getOpenInExplorerText()}</span>
          </DropdownMenuItem>
        )}
        {actions.workspacePath && (
          <DropdownMenuItem onClick={() => navigator.clipboard.writeText(actions.workspacePath)}>
            <Copy size={16} strokeWidth={1.5} />
            <span>Copy Path</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default () => {
  const [{ isOpen, anchorElement, actions }] = WorkspaceMenuAtom.use();
  if (!isOpen || !anchorElement || !actions) return null;
  return createElement(WorkspaceMenuDropdown, { anchorElement, actions });
};
