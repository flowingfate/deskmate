import React, { useState, createElement, useCallback } from 'react';
import { Pencil, Trash2, Copy, Upload, Archive, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../ui/ToastProvider';
import { useAgentById, getAgentById, usePrimaryAgentId } from '@/states/agents.atom';
import { persistApi } from '@/ipc/persist';
import { agentChatApi } from '@/ipc/agentChat';
import { atom } from '@/atom';
import { DuplicateAgentAtom } from '../overlay/DuplicateAgentOverlay';
import { DeleteConfirmAtom } from '../overlay/DeleteOverlay';
import { editAgent } from '@/lib/chat/editAgent';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/shadcn/dropdown-menu';

const zeroState: {
  isOpen: boolean;
  agentId: string | null;
  anchorElement: HTMLElement | null;
} = { isOpen: false, agentId: null, anchorElement: null };

export const AgentMenuAtom = atom(zeroState, (get, set) => {
  function close() {
    set(zeroState);
  }

  function toggle(agentId: string, buttonElement: HTMLElement) {
    const prev = get();
    if (prev.isOpen && prev.agentId === agentId) {
      return set(zeroState);
    }
    set({ isOpen: true, agentId, anchorElement: buttonElement });
  }

  return { toggle, close };
});


interface InnerProps {
  agentId: string | null;
  anchorElement: HTMLElement;
}

const AgentDropdownMenu: React.FC<InnerProps> = ({
  agentId,
  anchorElement,
}) => {
  const { close: onClose } = AgentMenuAtom.useChange();
  const currentAgent = useAgentById(agentId);
  const primaryAgentId = usePrimaryAgentId();
  const { showSuccess, showError } = useToast();
  const navigate = useNavigate();
  const [isImporting, setIsImporting] = useState(false);
  const onDuplicateAgent = DuplicateAgentAtom.useChange().show;
  const deleteConfirmActions = DeleteConfirmAtom.useChange();

  const anchorRect = anchorElement.getBoundingClientRect();

  // 受保护(locked)的 agent 不可归档/删除
  const isLocked = currentAgent?.locked === true;

  // Check if the current Agent is already the Primary Agent（按 id 直接比对）
  const isPrimaryAgent = primaryAgentId !== null && primaryAgentId === agentId;

  const handleEditAgentClick = (agentId: string) => {
    editAgent(agentId);
  };

  const handleDeleteAgentClick = (agentId: string) => {
    const agent = getAgentById(agentId);
    const agentName = agent?.name || 'Unknown Agent';
    deleteConfirmActions.showAgent(agentId, agentName, false);
  };

  // Handle archiving an agent
  const onArchiveAgent = useCallback(async (agentId: string) => {
    try {
      const agent = getAgentById(agentId);
      const agentName = agent?.name || 'Unknown Agent';

      const result = await persistApi.archiveAgent(agentId);

      if (result.success) {
        showSuccess(`Agent "${agentName}" archived successfully`);
        // agents.atom 订阅 persist:agent:removed 自动刷新
      } else {
        showError(`Failed to archive agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to archive agent: ${errorMessage}`);
    }
  }, [showSuccess, showError]);

  // Handle duplicating an Agent
  const handleDuplicateAgent = () => {
    if (agentId && currentAgent?.name) {
      onDuplicateAgent(agentId, currentAgent.name);
    }
  };

  // Handle setting as Primary Agent
  const handleSetAsPrimaryAgent = async () => {
    if (!agentId || !currentAgent?.name) {
      showError('Agent not found');
      return;
    }

    try {
      const result = await persistApi.setPrimaryAgent(agentId);

      if (result.success) {
        showSuccess(`${currentAgent.name} has been set as primary agent`);
        // agents.atom 订阅 persist:agent:registry:updated 自动刷新
      } else {
        showError(`Failed to set primary agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to set primary agent: ${errorMessage}`);
    }
  };

  // Import a complete chat-session ZIP into the current agent.
  const handleImportChatSessions = async () => {
    if (!agentId) {
      showError('Chat ID not found');
      return;
    }

    if (isImporting) {
      return;
    }

    try {
      setIsImporting(true);

      const result = await agentChatApi.importChatSession(agentId);

      if (result.success) {
        if (result.importedSessionId) {
          // sessionIndex.atom 订阅 persist:session:updated 自动刷新
          navigate(`/agent/${agentId}/${result.importedSessionId}`);
        }
        showSuccess('Successfully imported chat session');
      } else {
        if (result.error !== 'File selection canceled') {
          showError(`Import failed: ${result.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Import failed: ${errorMessage}`);
    } finally {
      setIsImporting(false);
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
        <DropdownMenuItem onClick={() => handleEditAgentClick(agentId!)}>
          <Pencil size={16} strokeWidth={1.5} />
          <span>Edit Agent</span>
        </DropdownMenuItem>
        {!isPrimaryAgent && (
          <DropdownMenuItem onClick={handleSetAsPrimaryAgent}>
            <Star size={16} strokeWidth={1.5} />
            <span>Set as Primary Agent</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleImportChatSessions} disabled={isImporting}>
          <Upload size={16} strokeWidth={1.5} />
          <span>{isImporting ? 'Importing...' : 'Import Chat Session ZIP'}</span>
        </DropdownMenuItem>
        {currentAgent?.name && (
          <DropdownMenuItem onClick={handleDuplicateAgent}>
            <Copy size={16} strokeWidth={1.5} />
            <span>Duplicate</span>
          </DropdownMenuItem>
        )}
        {onArchiveAgent && !isLocked && !isPrimaryAgent && (
          <DropdownMenuItem onClick={() => { if (agentId) onArchiveAgent(agentId); }}>
            <Archive size={16} strokeWidth={1.5} />
            <span>Archive Agent</span>
          </DropdownMenuItem>
        )}
        {!isLocked && !isPrimaryAgent && (
          <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => handleDeleteAgentClick(agentId!)}>
            <Trash2 size={16} strokeWidth={1.5} />
            <span>Delete Agent</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default () => {
  const [{ isOpen, agentId, anchorElement }] = AgentMenuAtom.use();
  if (!isOpen || !anchorElement) return null;
  return createElement(AgentDropdownMenu, { agentId, anchorElement });
};
