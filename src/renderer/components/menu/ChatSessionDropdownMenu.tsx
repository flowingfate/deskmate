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

type ClosedMenuState = { isOpen: false };
type OpenRegularMenuState = {
  isOpen: true;
  agentId: string;
  sessionId: string;
  title: string;
  starred: boolean;
  source: 'default';
  anchorElement: HTMLElement;
};
type OpenScheduleMenuState = {
  isOpen: true;
  agentId: string;
  sessionId: string;
  jobId: string;
  title: string;
  starred: boolean;
  source: 'schedule';
  anchorElement: HTMLElement;
};
type MenuState = ClosedMenuState | OpenRegularMenuState | OpenScheduleMenuState;

interface MenuActions {
  close(): void;
  toggle(agentId: string, sessionId: string, title: string, buttonElement: HTMLElement): void;
}

const zeroState: MenuState = { isOpen: false };

export const ChatSessionMenuAtom = atom<MenuState, MenuActions>(zeroState, (get, set) => {
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
    if (source === 'schedule') {
      const jobId = buttonElement.dataset.chatSessionMenuJobId;
      if (!jobId) {
        logger.warn({ msg: 'Schedule menu opened without job id', sessionId });
        return;
      }
      set({ isOpen: true, agentId, sessionId, jobId, title, starred, source, anchorElement: buttonElement });
      return;
    }
    set({ isOpen: true, agentId, sessionId, title, starred, source, anchorElement: buttonElement });
  }

  return { toggle, close };
});

type InnerProps = OpenRegularMenuState | OpenScheduleMenuState;

const ChatSessionDropdownMenu: React.FC<InnerProps> = (props) => {
  const { agentId, sessionId, title, starred, source, anchorElement } = props;
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
    if (props.source === 'schedule') {
      runCommand({
        type: 'downloadScheduleRun',
        agentId,
        jobId: props.jobId,
        runId: sessionId,
        title,
      });
      return;
    }
    runCommand({ type: 'download', agentId, sessionId, title });
  };

  const handleDeleteChatSession = () => {
    if (props.source === 'schedule') {
      runCommand({
        type: 'deleteScheduleRun',
        agentId,
        jobId: props.jobId,
        runId: sessionId,
        name: title,
      });
      return;
    }
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
  const [state] = ChatSessionMenuAtom.use();
  if (!state.isOpen) return null;
  return createElement(ChatSessionDropdownMenu, state);
};
