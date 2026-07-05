import { atom } from '@/atom';
import { agentSessionCacheManager } from '@renderer/lib/chat/agentSessionCacheManager';
import { deleteAgentConfig } from '@renderer/lib/chat/agentOps';
import { deleteChatSession } from '@renderer/lib/chat/chatSessionOps';
import { startNewSessionFor } from '@renderer/lib/chat/startNewSessionFor';
import { getProfileId } from '@/states/profile.atom';
import { getAgents, getPrimaryAgentId } from '@/states/agents.atom';
import { log } from '@/log';
import { agentChatApi } from '@/ipc/agentChat';
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

interface State {
  isOpen: boolean;
  type: 'agent' | 'chat-session';
  id: string | null;
  name: string | null;
  isCurrentSession?: boolean;
}

const zeroState: State = {
  isOpen: false,
  type: 'agent',
  id: null,
  name: null,
  isCurrentSession: false,
};

export const DeleteConfirmAtom = atom(zeroState, (get, set) => {
  function cancel() {
    set(zeroState);
  }

  function showAgent(id: string, name: string, isCurrentSession?: boolean) {
    set({ isOpen: true, type: 'agent', id, name, isCurrentSession });
  }

  function showChatSession(id: string, name: string, isCurrentSession?: boolean) {
    set({ isOpen: true, type: 'chat-session', id, name, isCurrentSession });
  }

  async function confirm(toast: ToastContextType, navigate: NavigateFunction, currentPath: string) {
    const { type, id, name, isCurrentSession } = get();
    if (!id) return;

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
              const result = await startNewSessionFor(
                targetAgentId,
              );
              logger.debug({ msg: "startNewSessionFor result:", data: result });

              if (result.success && result.chatSessionId) {
                logger.debug({ msg: "Navigating to new agent route:", targetAgentId, newChatSessionId: result.chatSessionId });
                navigate(`/agent/${targetAgentId}/${result.chatSessionId}`, { replace: true });
              } else {
                logger.error({ msg: "Failed to start new chat for fallback agent:", err: result?.error, result });
              }
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

        const profileAlias = getProfileId();

        if (!profileAlias) {
          showError('No profile alias available');
          return;
        }

        // Fix: adjust delete order per design doc
        // Step 3: if deleting the CurrentChatSessionId, switch to a new session first
        if (isCurrentSession) {
          // 3b. Switch to a new ChatSession via startNewSessionFor + 显式 navigate
          // 新架构下，主进程不再 echo currentChatSessionIdChanged；source of truth 是路由。
          if (currentAgentId) {
            const newResult = await startNewSessionFor(currentAgentId);
            if (newResult.success && newResult.chatSessionId) {
              navigate(`/agent/${currentAgentId}/${newResult.chatSessionId}`, { replace: true });
            }
          }
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
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      set(zeroState);
    }
  }

  return { cancel, confirm, showAgent, showChatSession };
});

export function DeleteOverlay() {
  const [deleteConfirmState, actions] = DeleteConfirmAtom.use();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <AlertDialog
      open={deleteConfirmState.isOpen}
      onOpenChange={(open) => {
        if (!open) actions.cancel();
      }}
    >
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleteConfirmState.type === 'agent' ? 'Delete Agent' : 'Delete Chat Session'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{deleteConfirmState.name}</strong>?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-sc-destructive">
          {deleteConfirmState.type === 'chat-session' && deleteConfirmState.isCurrentSession
            ? "This is the currently selected session. After deletion, it will switch to a new conversation. This action cannot be undone and all chat history will be permanently deleted."
            : "This action cannot be undone. All chat history will be permanently deleted."
          }
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-sc-destructive text-sc-destructive-foreground hover:bg-sc-destructive/90"
            onClick={() => actions.confirm(toast, navigate, location.pathname)}
          >
            {deleteConfirmState.type === 'agent' ? 'Delete Agent' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

