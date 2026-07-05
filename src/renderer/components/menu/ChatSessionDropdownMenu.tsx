import React, { createElement } from 'react';
import { Trash2, Download, Pencil, Star, Copy, GitFork } from 'lucide-react';
import { atom } from '@/atom';
import { log } from '@/log';
import { chatSessionApi } from '@/ipc/chatSession';
import { chatSessionCommands } from '@/states/chatSessionCommands';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';
const logger = log.child({ mod: 'ChatSessionDropdownMenu' });

const zeroState: {
  isOpen: boolean;
  agentId: string | null;
  sessionId: string | null;
  title: string | null;
  starred: boolean;
  source: 'default' | 'schedule';
  anchorElement: HTMLElement | null;
} = {
  isOpen: false,
  agentId: null,
  sessionId: null,
  title: null,
  starred: false,
  source: 'default',
  anchorElement: null,
};

export const ChatSessionMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function toggle(
    agentId: string,
    sessionId: string,
    title: string,
    buttonElement: HTMLElement,
  ) {
    const prev = get();
    if (prev.isOpen && prev.sessionId === sessionId) {
      return set(zeroState);
    }

    const source = buttonElement.dataset.chatSessionMenuSource === 'schedule'
      ? 'schedule' as const
      : 'default' as const;
    const starred = buttonElement.dataset.chatSessionStarred === 'true';

    set({ isOpen: true, agentId, sessionId, title, starred, source, anchorElement: buttonElement });
  }

  return { toggle, close };
});

interface InnerProps {
  agentId: string | null;
  sessionId: string;
  title: string | null;
  starred: boolean;
  source: 'default' | 'schedule';
  anchorElement: HTMLElement;
}

const ChatSessionDropdownMenu: React.FC<InnerProps> = ({
  agentId,
  sessionId,
  title,
  starred,
  source,
  anchorElement,
}) => {
  const { close: onClose } = ChatSessionMenuAtom.useChange();
  const runCommand = chatSessionCommands.use();

  const anchorRect = anchorElement.getBoundingClientRect();

  const isScheduleMenu = source === 'schedule';
  const handleToggleStarChatSession = () => {
    if (!agentId || isScheduleMenu) {
      return;
    }
    runCommand({ type: 'toggleStar', agentId, sessionId, starred: !starred });
  };

  const handleCopyFilePath = async () => {
    if (!agentId) {
      return;
    }

    try {
      const result = await chatSessionApi.getFilePath(agentId, sessionId);
      if (result.success && result.filePath) {
        await navigator.clipboard.writeText(result.filePath);
      }
    } catch (error) {
      logger.error({ msg: "Failed to copy file path:", err: error });
    }
  };

  const handleRenameChatSession = () => {
    if (!agentId) return;
    runCommand({ type: 'rename', agentId, sessionId, title: title ?? '' });
  };

  const handleForkChatSession = () => {
    runCommand({ type: 'fork', sessionId });
  };

  const handleDownloadChatSession = () => {
    if (!agentId) return;
    runCommand({ type: 'download', agentId, sessionId, title: title ?? '' });
  };

  const handleDeleteChatSession = () => {
    runCommand({ type: 'delete', sessionId });
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
        {!isScheduleMenu && (
          <DropdownMenuItem onClick={handleToggleStarChatSession}>
            <Star size={16} strokeWidth={1.5} fill={starred ? 'currentColor' : 'none'} />
            <span>{starred ? 'Unstar' : 'Star'}</span>
          </DropdownMenuItem>
        )}
        {!isScheduleMenu && (
          <DropdownMenuItem onClick={handleRenameChatSession}>
            <Pencil size={16} strokeWidth={1.5} />
            <span>Rename</span>
          </DropdownMenuItem>
        )}
        {!isScheduleMenu && (
          <DropdownMenuItem onClick={handleForkChatSession}>
            <GitFork size={16} strokeWidth={1.5} />
            <span>Fork</span>
          </DropdownMenuItem>
        )}
        {!isScheduleMenu && !!agentId && (
          <DropdownMenuItem onClick={handleCopyFilePath}>
            <Copy size={16} strokeWidth={1.5} />
            <span>Copy File Path</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleDownloadChatSession}>
          <Download size={16} strokeWidth={1.5} />
          <span>Download</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={handleDeleteChatSession}>
          <Trash2 size={16} strokeWidth={1.5} />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default () => {
  const [{ isOpen, agentId, sessionId, title, starred, source, anchorElement }] = ChatSessionMenuAtom.use();
  if (!isOpen || !anchorElement || !sessionId) return null;
  return createElement(ChatSessionDropdownMenu, { agentId, sessionId, title, starred, source, anchorElement });
};
