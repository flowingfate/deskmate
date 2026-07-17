import { useRef } from 'react';
import { atom } from '@/atom';
import { agentSessionCacheManager } from '@renderer/lib/chat/agentSessionCacheManager';
import { deleteAgentConfig } from '@renderer/lib/chat/agentOps';
import { deleteChatSession } from '@renderer/lib/chat/chatSessionOps';
import { newEntityId } from '@shared/persist/id';
import { getAgents, getPrimaryAgentId } from '@/states/agents.atom';
import { log } from '@/log';
import { agentChatApi } from '@/ipc/agentChat';
import { persistApi } from '@/ipc/persist';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shadcn/alert-dialog';

const logger = log.child({ mod: 'DeleteOverlay' });
import { useToast, type ToastContextType } from '../ui/ToastProvider';
import { type NavigateFunction, useNavigate, useLocation } from 'react-router-dom';

type DeleteTarget =
  | { type: 'agent'; id: string; name: string; isCurrentSession: boolean }
  | { type: 'chat-session'; id: string; name: string; isCurrentSession: boolean }
  | {
    type: 'schedule-run';
    id: string;
    agentId: string;
    jobId: string;
    name: string;
    isCurrentSession: boolean;
  };

type State =
  | { isOpen: false }
  | { isOpen: true; target: DeleteTarget };

interface DeleteActions {
  cancel(): void;
  confirm(toast: ToastContextType, navigate: NavigateFunction, currentPath: string): Promise<void>;
  showAgent(id: string, name: string, isCurrentSession?: boolean): void;
  showChatSession(id: string, name: string, isCurrentSession?: boolean): void;
  showScheduleRun(agentId: string, jobId: string, id: string, name: string, isCurrentSession?: boolean): void;
}

const zeroState: State = { isOpen: false };

export const DeleteConfirmAtom = atom<State, DeleteActions>(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function showAgent(id: string, name: string, isCurrentSession = false) {
    set({ isOpen: true, target: { type: 'agent', id, name, isCurrentSession } });
  }

  function showChatSession(id: string, name: string, isCurrentSession = false) {
    set({ isOpen: true, target: { type: 'chat-session', id, name, isCurrentSession } });
  }

  function showScheduleRun(
    agentId: string,
    jobId: string,
    id: string,
    name: string,
    isCurrentSession = false,
  ) {
    set({ isOpen: true, target: { type: 'schedule-run', agentId, jobId, id, name, isCurrentSession } });
  }

  async function confirm(toast: ToastContextType, navigate: NavigateFunction, currentPath: string) {
    const state = get();
    if (!state.isOpen) return;
    const { type, id, name, isCurrentSession } = state.target;

    const { showError, showSuccess } = toast;
    try {
      if (type === 'agent') {
        // Fix: check if Agent switch is needed
        // 1. Check if the deleted chat is the current chat in cache manager
        const currentAgentId = agentSessionCacheManager.getCurrentAgentId();
        const isDeletingCurrentChat = id === currentAgentId;

        // 2. New: check if the current route belongs to the deleted agent (handles deletion from settings page)
        const isOnDeletedAgentRoute = currentPath.includes(`/agent/${id}`);

        // Switch condition: deleting the current chat, or current route belongs to the deleted agent
        const needsSwitch = isDeletingCurrentChat || isOnDeletedAgentRoute;

        logger.debug({ msg: "Delete agent check:", deletedAgentId: id, currentAgentId, isDeletingCurrentChat, currentPath, isOnDeletedAgentRoute, needsSwitch });

        // Step 2: Execute delete operation
        const result = await deleteAgentConfig(id);

        if (result.success) {
          // Step 3: If switch needed, switch to Primary Agent
          if (needsSwitch) {
            // 切到 primary agent（不存在则退到任意其它 agent）
            const agents = getAgents();
            const primaryId = getPrimaryAgentId();
            const targetAgent =
              (primaryId ? agents.find((a) => a.id === primaryId && a.id !== id) : undefined)
              ?? agents.find((a) => a.id !== id);
            const targetAgentId = targetAgent?.id;

            logger.debug({ msg: "Delete agent - switching to fallback agent:", deletedAgentId: id, targetAgentId, agentsCount: agents.length });

            if (targetAgentId) {
              const chatSessionId = newEntityId('s');
              logger.debug({ msg: "Delete agent - opening fallback agent", targetAgentId, chatSessionId });
              navigate(`/agent/${targetAgentId}/${chatSessionId}`, { replace: true });
            } else {
              logger.error({ msg: "No fallback agent found after deletion", availableAgents: agents.map((a) => a.id) });
            }
          }
          // Fix: show success message after deletion
          showSuccess(
            `Agent "${name}" deleted successfully`,
          );
        } else {
          showError(
            `Failed to delete agent: ${result.error || 'Unknown error'}`,
          );
        }
      } else if (type === 'chat-session') {
        const currentAgentId = agentSessionCacheManager.getCurrentAgentId();
        if (!currentAgentId) {
          showError('No current agent chat available');
          return;
        }


        // Navigate away before deleting the current session; the route is the active-session source of truth.
        if (isCurrentSession) {
          const chatSessionId = newEntityId('s');
          navigate(`/agent/${currentAgentId}/${chatSessionId}`, { replace: true });
        }

        // Step 4: Delete the ChatSession for the corresponding chatSessionId
        // 4a. AgentChatManager deletes the corresponding AgentChat instance and registration
        const sessionCache = agentSessionCacheManager.getChatSessionCache(id);
        const agentIdForSession = sessionCache?.agentId ?? currentAgentId;
        if (agentIdForSession) {
          await agentChatApi.removeAgentInstance(agentIdForSession, id);
        }

        // 4b & 4c. ProfileCacheManager deletes metadata and local records, syncs to ProfileDataManager
        const deleteResult = await deleteChatSession(
          currentAgentId,
          id,
        );
        if (!deleteResult.success) {
          showError(`Failed to delete session: ${deleteResult.error}`);
          return;
        }

        // 4d. main 写盘后通过 persist 通道反向广播；sessionIndex.atom / sessionData.atom 自动刷新。

        showSuccess(
          `Session "${name}" deleted successfully`,
        );
      } else if (type === 'schedule-run') {
        const target = state.target;
        if (target.type !== 'schedule-run') return;
        if (target.isCurrentSession) {
          navigate(`/agent/${target.agentId}/job/${target.jobId}`, { replace: true });
        }
        const deleteResult = await persistApi.deleteScheduleRun(target.agentId, target.jobId, target.id);
        if (!deleteResult.success) {
          showError(`Failed to delete schedule run: ${deleteResult.error}`);
          return;
        }
        showSuccess(`Schedule run "${target.name}" deleted successfully`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      set(zeroState);
    }
  }

  return { cancel, confirm, showAgent, showChatSession, showScheduleRun };
});

export function DeleteOverlay() {
  const [deleteConfirmState, actions] = DeleteConfirmAtom.use();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const deleteActionRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      open={deleteConfirmState.isOpen}
      onOpenChange={(open) => {
        if (!open) actions.cancel();
      }}
    >
      <AlertDialogContent className="max-w-md" initialFocusRef={deleteActionRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleteConfirmState.isOpen && deleteConfirmState.target.type === 'agent'
              ? 'Delete Agent'
              : deleteConfirmState.isOpen && deleteConfirmState.target.type === 'schedule-run'
                ? 'Delete Schedule Run'
                : 'Delete Chat Session'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{deleteConfirmState.isOpen ? deleteConfirmState.target.name : ''}</strong>?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-sc-destructive">
          {deleteConfirmState.isOpen
            && deleteConfirmState.target.type === 'chat-session'
            && deleteConfirmState.target.isCurrentSession
            ? "This is the currently selected session. After deletion, it will switch to a new conversation. This action cannot be undone and all chat history will be permanently deleted."
            : "This action cannot be undone. All chat history will be permanently deleted."
          }
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            ref={deleteActionRef}
            className="bg-sc-destructive text-sc-destructive-foreground hover:bg-sc-destructive/90"
            onClick={() => actions.confirm(toast, navigate, location.pathname)}
          >
            {deleteConfirmState.isOpen && deleteConfirmState.target.type === 'agent' ? 'Delete Agent' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

