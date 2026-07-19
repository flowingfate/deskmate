import { atom } from '@/atom';
import { ToastActions } from '../../ui/toast.atom';
type ToastContextType = ToastActions;
import { agentIpc } from '@/lib/chat/agentIpc';
import type { UserMessage } from '@shared/persist/types'
import type { RenderMessage, RenderUserMessage } from '@/lib/chat/renderMessage';
import { agentSessionCacheManager } from '@/lib';


export interface EditingMessageState {
  agentId: string;
  sessionId: string;
  id: string;
  index: number;
  message: RenderUserMessage;
  warningMessage: string | null;
}

export const editMessageAtom = atom(null as (EditingMessageState | null), (get, set) => {

  async function start(
    sessionId: string,
    index: number,
    message: RenderMessage,
    warningMessage: string | null,
    toast: ToastContextType,
  ) {
    if (message.role !== 'user') return;
    const id = message.id;
    const cache = agentSessionCacheManager.getChatSessionCache(sessionId);
    if (!cache?.agentId) {
      toast.showToast('Cannot edit: no agentId for session', 'error', undefined, { persistent: true });
      return;
    }
    const agentId = cache.agentId;
    try {
      const validation = await agentIpc.canEditUserMessage(agentId, sessionId, id);
      if (!validation.canEdit) {
        toast.showToast(validation.error || 'This message can no longer be edited.', 'error', undefined, { persistent: true });
        return;
      }
      set({ agentId, sessionId, id, index, message, warningMessage });
    } catch (error) {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to validate whether this message can be edited.',
        'error',
        undefined,
        { persistent: true },
      );
    }
  }

  function cancel() {
    set(null);
  }

  async function save(updatedMessage: UserMessage) {
    const state = get();
    if (!state) return;
    const { agentId, sessionId, id, index } = state;

    const cache = agentSessionCacheManager.getChatSessionCache(sessionId);
    const messages: RenderMessage[] = cache?.messages ?? [];
    const truncatedMessages: RenderMessage[] = [
      ...messages.slice(0, index),
      updatedMessage,
    ];

    agentSessionCacheManager.clearErrorMessage(sessionId);
    agentSessionCacheManager.replaceMessages(sessionId, truncatedMessages, {
      chatStatus: 'idle',
      streamingMessageId: null,
      pendingInteractiveRequests: [],
      errorMessage: null,
    });

    set(null);

    try {
      await agentIpc.editUserMessage(agentId, sessionId, id, updatedMessage);
    } catch (error) {
      agentSessionCacheManager.replaceMessages(sessionId, messages, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { start, cancel, save };
});
