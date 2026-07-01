import type { UserMessage } from '@shared/types/message';
import { agentSessionCacheManager } from './agentSessionCacheManager';
import { agentIpc } from './agentIpc';
import { traceContext } from './traceContext';
import { Tracer } from '@shared/log/trace';
import { log as logger } from '@/log';
type ChatSessionSendCache = {
  getUserMessageSendState: (chatSessionId: string | null | undefined) => {
    canSend: boolean;
    error: string;
    chatStatus: string | null;
  };
  addUserMessage: (chatSessionId: string, userMessage: UserMessage) => void;
  removeMessage: (chatSessionId: string, messageId: string) => void;
  setErrorMessage: (chatSessionId: string, errorMessage: string) => void;
};

export async function sendUserMessageOptimistically<T>(options: {
  chatSessionId: string | null | undefined;
  userMessage: UserMessage;
  cacheManager: ChatSessionSendCache;
  send: () => Promise<T>;
}): Promise<T> {
  const { chatSessionId, userMessage, cacheManager, send } = options;
  if (!userMessage.id) {
    throw new Error('Optimistic user messages must have a stable message id.');
  }
  const sendState = cacheManager.getUserMessageSendState(chatSessionId);

  if (!chatSessionId || !sendState.canSend) {
    if (chatSessionId) {
      cacheManager.setErrorMessage(chatSessionId, sendState.error);
    }
    throw new Error(sendState.error);
  }

  cacheManager.addUserMessage(chatSessionId, userMessage);

  try {
    return await send();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Only roll back the optimistic user message if it was never persisted by the backend.
    // Pre-persistence rejections are returned by agentChatManager.streamMessage before
    // addMessageToSession runs — they match known error patterns below.
    // Post-persistence failures (API errors after addMessageToSession) should keep the message
    // in the cache — it already exists on disk and will reappear on session switch anyway.
    const isPrePersistenceRejection =
      /chat status is/i.test(errorMessage) ||
      /No agent instance found/i.test(errorMessage);
    if (isPrePersistenceRejection) {
      cacheManager.removeMessage(chatSessionId, userMessage.id);
    }

    cacheManager.setErrorMessage(chatSessionId, errorMessage);
    throw error;
  }
}

export async function sendUserMessage(message: UserMessage) {
  const chatSessionId = agentSessionCacheManager.getCurrentChatSessionId();
  const agentId = agentSessionCacheManager.getCurrentAgentId();
  if (!chatSessionId || !agentId) {
    logger.error({ mod: 'chat.send', msg: 'enqueue failed', err: 'No active chat session' });
    return;
  }

  // 主链路 trace 起点：tracer 同时存 tid + 起算时刻，session-manager 收到
  // status=idle 时 derive 出 chat.recv tracer，用 fields(..., 'root') 报告
  // 端到端时延（从这里的 startAt 起算）。
  const tracer = Tracer.startWithSpan()
    .bind({ mod: 'chat.send', chatSessionId, agentId, msgId: message.id });
  traceContext.start(chatSessionId, tracer);

  logger.info(tracer.fields({ msg: 'enqueue' }));

  try {
    await sendUserMessageOptimistically({
      chatSessionId,
      userMessage: message,
      cacheManager: agentSessionCacheManager,
      send: () => agentIpc.streamMessage(agentId, chatSessionId, message, tracer.serialize()),
    });
  } catch (error) {
    // 终态错误：fail 路径下 chat.recv 不会被触发，这里把 trace 上下文清掉避免泄漏。
    traceContext.consume(chatSessionId);
    logger.warn(tracer.fields({ msg: 'enqueue failed', err: error }, 'self'));
  }
}
