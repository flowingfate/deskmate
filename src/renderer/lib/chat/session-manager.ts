/**
 * SessionManager —— renderer 端 chat session 内存模型 + 流式拼接。
 *
 * 数据形态 (RenderMessage[]):
 *   - 顶层只有 user / assistant;tool 结果折在 assistant.tool_calls[i].response。
 *   - assistant 多挂 `streamingComplete: boolean`,UI 据此显示流式光标 / 收尾态。
 *
 * 流式 chunk 的处理责任:
 *   - `thinking`  → 找/建对应 assistant,`think += text`
 *   - `content`   → 找/建对应 assistant,`content += text`
 *   - `tool_call` → 找/建对应 assistant,`tool_calls[index] = { id, name, args, time }`
 *                   (主进程在 toolcall_end 一次性发完整 args,renderer 不再累加字符串增量)
 *   - `tool_result` → 找上一条 assistant 中 id 匹配的 ToolCall,设其 `response`
 *                     (覆盖式;shell 等工具会发多条 partial chunk,每条都是覆盖)
 *   - `complete`  → assistant.streamingComplete = true;清 streamingMessageId
 *   - `status_changed` → 推 chatStatus + contextTokenUsage
 */

import { produce, original, type WritableDraft } from 'immer';
import type {
  ContentChunk,
  ThinkingChunk,
  ToolCallChunk,
  ToolResultChunk,
  CompleteChunk,
  StatusChangedChunk,
  StreamingChunk,
} from '@shared/types/streamingTypes';
import type { ToolResult } from '@shared/types/message';
import type { InteractiveMap, InteractiveRequestType } from '@shared/types/interactiveRequestTypes';
import type { ContextTokenUsage } from '@shared/types/agentChatTypes';
import Resolveable from '@shared/resolveable-promise';
import { log } from '@/log';
import {
  type RenderAssistantMessage,
  type RenderMessage,
  type RenderUserMessage,
  liftToRender,
} from './renderMessage';
import { traceContext } from './traceContext';

const logger = log.child({ mod: 'SessionManager' });

/**
 * ChatStatus —— 与主进程 ChatStatus 字符串值一致(不直接 import enum 是为了让 hook
 * 消费方走字面量类型,渲染层不引主进程枚举)。
 */
export type ChatStatus =
  | 'idle'
  | 'sending_response'
  | 'compressing_context'
  | 'compressed_context'
  | 'received_response';

export type PendingInteractiveRequestMap = {
  [K in InteractiveRequestType]: {
    type: K;
    id: string;
    request: InteractiveMap[K]['in'];
    task: Resolveable<InteractiveMap[K]['out']>;
  };
};

export type PendingInteractiveRequest = PendingInteractiveRequestMap[InteractiveRequestType];

export interface ChatSessionCache {
  chatSessionId: string;
  agentId: string;
  /** 已物化为 Render 形态(assistant 都带 streamingComplete)。 */
  messages: RenderMessage[];
  chatStatus: ChatStatus;
  /** 当前 streaming 中的 assistant message id;非流式时为 null。 */
  streamingMessageId: string | null;
  contextTokenUsage: ContextTokenUsage;
  lastUpdated: number;
  pendingInteractiveRequests: PendingInteractiveRequest[];
  /** 显示在 ErrorBar 的错误。 */
  errorMessage?: string | null;
  /** Assistant Say-Hi greeting markdown(纯 UI 状态,不进 message 流)。 */
  greetingContent?: string | null;
}

interface Sessions {
  [id: string]: ChatSessionCache | undefined;
}

type ChangeType = 'add' | 'update' | 'remove';
type ChangedMessagesInSession = Array<{ message: RenderMessage; type: ChangeType }>;
export type SessionListener = (session: ChatSessionCache, type: ChangeType) => void;
export type MessageListener = (message: ChangedMessagesInSession, session: ChatSessionCache) => void;

const EMPTY_TOKEN_USAGE: ContextTokenUsage = {
  tokenCount: 0,
  totalMessages: 0,
  contextMessages: 0,
  compressionRatio: 1.0,
};

export class SessionManager {
  private chatSessionCaches: Sessions = {};
  private sessionListeners = new Set<SessionListener>();
  private messageListeners = new Set<MessageListener>();
  private pendingMessageUpdates = new Map<string, [RenderMessage, ChangeType]>();

  onSessionChange(listener: SessionListener) {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  onMessageChange(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private markMessage(message: RenderMessage, type: ChangeType) {
    this.pendingMessageUpdates.set(message.id, [message, type]);
  }

  /**
   * Immutable session update via immer produce. All mutation sites走这里。
   */
  private updateSession(
    id: string,
    editFn: (session: WritableDraft<ChatSessionCache>) => void,
    tag?: string,
  ) {
    const session = this.chatSessionCaches[id];
    if (!session) {
      logger.warn({ msg: `Cache not found for chatSessionId${tag ? `---${tag}` : ''}`, chatSessionId: id });
      return 'none' as const;
    }
    const next = produce(session, (draft) => editFn(draft));
    if (next === session) return 'unchanged' as const;

    this.chatSessionCaches[id] = next;

    if (this.pendingMessageUpdates.size > 0) {
      const changes: ChangedMessagesInSession = [];
      this.pendingMessageUpdates.forEach(([message, type]) => {
        changes.push({ message, type });
      });
      this.messageListeners.forEach((f) => f(changes, next));
      this.pendingMessageUpdates.clear();
    }
    this.sessionListeners.forEach((f) => f(next, 'update'));

    return 'updated' as const;
  }

  /**
   * 把后端 snapshot 与已有 cache 合并:对正在流式的 assistant 保留 cache 端版本,
   * snapshot 短于 cache 时把 cache 末尾多出来的消息保留(避免切走再切回时已渲染
   * 的流式内容被空 snapshot 覆盖)。规则与原实现一致。
   */
  private mergeSnapshotMessagesWithExistingCache(
    incoming: RenderMessage[],
    existing: ChatSessionCache,
  ): RenderMessage[] {
    if (existing.messages.length === 0) return incoming;

    const existingById = new Map<string, RenderMessage>();
    for (const m of existing.messages) {
      if (m.id) existingById.set(m.id, m);
    }

    const merged = incoming.map((m) => {
      if (!m.id) return m;
      if (existing.streamingMessageId && m.id === existing.streamingMessageId) {
        return existingById.get(m.id) ?? m;
      }
      return m;
    });
    const mergedIds = new Set(merged.map((m) => m.id).filter((s): s is string => Boolean(s)));

    const incomingIsPrefix =
      incoming.length === 0 ||
      (incoming.length <= existing.messages.length &&
        incoming.every((m, i) => existing.messages[i]?.id === m.id));

    if (!incomingIsPrefix) {
      logger.debug({
        msg: 'Skipping trailing cache preservation for divergent snapshot',
        chatSessionId: existing.chatSessionId,
        incomingCount: incoming.length,
        existingCount: existing.messages.length,
        streamingMessageId: existing.streamingMessageId,
      });
      return merged;
    }

    const trailing = existing.messages.filter((m) => m.id && !mergedIds.has(m.id));
    if (trailing.length === 0) return merged;

    logger.debug({
      msg: 'Preserving newer cached messages during cache refresh',
      chatSessionId: existing.chatSessionId,
      incomingCount: incoming.length,
      existingCount: existing.messages.length,
      appendedCount: trailing.length,
      streamingMessageId: existing.streamingMessageId,
    });
    return [...merged, ...trailing];
  }

  /**
   * 创建/重建 cache。initialData.messages 接收 Domain Message;本方法负责 lift
   * 到 RenderMessage(assistant 默认 streamingComplete=true)。
   */
  handleChatSessionCacheCreated(
    chatSessionId: string,
    agentId: string,
    initialData?: Partial<ChatSessionCache>,
  ): boolean {
    logger.debug({ msg: 'Creating chat session cache', chatSessionId, agentId, hasInitialData: !!initialData });

    let messages: RenderMessage[] = initialData?.messages ?? [];
    const existing = this.chatSessionCaches[chatSessionId];
    if (existing) {
      messages = this.mergeSnapshotMessagesWithExistingCache(messages, existing);
    }

    const newCache: ChatSessionCache = {
      chatSessionId,
      agentId,
      messages,
      chatStatus: initialData?.chatStatus ?? 'idle',
      streamingMessageId:
        initialData?.streamingMessageId !== undefined
          ? initialData.streamingMessageId
          : existing?.streamingMessageId ?? null,
      contextTokenUsage: initialData?.contextTokenUsage ?? existing?.contextTokenUsage ?? EMPTY_TOKEN_USAGE,
      pendingInteractiveRequests:
        initialData?.pendingInteractiveRequests ?? existing?.pendingInteractiveRequests ?? [],
      errorMessage:
        initialData?.errorMessage !== undefined ? initialData.errorMessage : existing?.errorMessage,
      greetingContent: existing?.greetingContent ?? null,
      lastUpdated: Date.now(),
    };

    this.chatSessionCaches[chatSessionId] = newCache;
    this.sessionListeners.forEach((f) => f(newCache, 'add'));

    return Boolean(existing);
  }

  handleChatSessionCacheDestroyed(chatSessionId: string) {
    logger.debug({ msg: 'Destroying chat session cache', chatSessionId });
    const cache = this.chatSessionCaches[chatSessionId];
    if (cache) {
      delete this.chatSessionCaches[chatSessionId];
      this.sessionListeners.forEach((f) => f(cache, 'remove'));
      return true;
    }
  }

  handleChatStatusChanged(chatSessionId: string, chatStatus: ChatStatus) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        session.chatStatus = chatStatus;
        session.lastUpdated = Date.now();

        if (chatStatus === 'idle') {
          // 切到 idle 时清掉 streaming 副状态,确保下一轮起步干净。
          if (session.streamingMessageId) session.streamingMessageId = null;
          if (session.pendingInteractiveRequests.length > 0) {
            for (const pending of session.pendingInteractiveRequests) {
              if (pending.task.isPending) pending.task.reject(new Error('Chat cancelled'));
            }
            session.pendingInteractiveRequests = [];
          }
        }
      },
      'handleChatStatusChanged',
    );
    return result === 'updated';
  }

  handleContextChange(chatSessionId: string, stats: Partial<ContextTokenUsage> | undefined) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        session.contextTokenUsage = {
          tokenCount: stats?.tokenCount ?? 0,
          totalMessages: stats?.totalMessages ?? 0,
          contextMessages: stats?.contextMessages ?? 0,
          compressionRatio: stats?.compressionRatio ?? 1.0,
        };
        session.lastUpdated = Date.now();
      },
      'handleContextChange',
    );
    return result === 'updated';
  }

  private handleStatusChangedChunk(chatSessionId: string, chunk: StatusChangedChunk) {
    this.handleChatStatusChanged(chatSessionId, chunk.chatStatus as ChatStatus);
    if (chunk.contextStats) this.handleContextChange(chatSessionId, chunk.contextStats);

    // 主链路收尾:status=idle 是一次 turn 的终态(compress / response 中间态都是非 idle)。
    if (chunk.chatStatus === 'idle') {
      const parent = traceContext.consume(chatSessionId);
      if (parent) {
        const recv = parent.derive().bind({ mod: 'chat.recv' });
        log.info(recv.fields({ msg: 'render complete' }, 'root'));
      }
    }
  }

  handleStreamingChunk(chatSessionId: string, chunk: StreamingChunk) {
    if (chunk.type === 'status_changed') {
      this.handleStatusChangedChunk(chatSessionId, chunk);
      return true;
    }

    const result = this.updateSession(
      chatSessionId,
      (cache) => {
        // tool_result 关联到上一条 assistant,messageId 字段是 toolCallId,跟
        // streamingMessageId 不绑定。其余 chunk(thinking / content / tool_call /
        // complete)都共享 assistant message id。
        if (chunk.type !== 'complete' && chunk.type !== 'tool_result' && chunk.messageId) {
          if (cache.streamingMessageId !== chunk.messageId) {
            cache.streamingMessageId = chunk.messageId;
          }
        }

        switch (chunk.type) {
          case 'thinking':
            this.handleThinkingChunk(cache, chunk);
            break;
          case 'content':
            this.handleContentChunk(cache, chunk);
            break;
          case 'tool_call':
            this.handleToolCallChunk(cache, chunk);
            break;
          case 'tool_result':
            this.handleToolResultChunk(cache, chunk);
            break;
          case 'complete':
            this.handleCompleteChunk(cache, chunk);
            break;
          default: {
            const _exhaustive: never = chunk;
            void _exhaustive;
            logger.warn({ msg: 'Unknown chunk type', chunk });
          }
        }
      },
      'handleStreamingChunk',
    );

    return result === 'updated';
  }

  /**
   * 添加用户消息(本地 optimistic)。`userMessage` 已是 Domain UserMessage(Render 等价)。
   */
  addUserMessage(chatSessionId: string, userMessage: RenderUserMessage) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        this.markMessage(userMessage, 'add');
        session.messages.push(userMessage);
        session.greetingContent = null;
        session.lastUpdated = Date.now();
      },
      'addUserMessage',
    );
    return result === 'updated';
  }

  removeMessage(chatSessionId: string, messageId: string) {
    const result = this.updateSession(chatSessionId, (session) => {
      const i = session.messages.findIndex((m) => m.id === messageId);
      if (i === -1) return;
      const target = original(session.messages[i])!;
      this.markMessage(target, 'remove');
      session.messages.splice(i, 1);
      session.lastUpdated = Date.now();
    });
    return result === 'updated';
  }

  private getOrCreateAssistantDraft(
    cache: WritableDraft<ChatSessionCache>,
    messageId: string,
    timestamp: number,
  ): WritableDraft<RenderAssistantMessage> {
    const i = cache.messages.findIndex((m) => m.id === messageId);
    if (i !== -1) {
      const m = cache.messages[i];
      if (m.role !== 'assistant') {
        // 不应发生:同 id 命中非 assistant 行。降级新建一条。
        logger.warn({ msg: 'Streaming chunk hit non-assistant message id, creating new one', messageId, hitRole: m.role });
      } else {
        return m;
      }
    }
    const fresh: RenderAssistantMessage = {
      role: 'assistant',
      id: messageId,
      time: timestamp,
      think: '',
      content: '',
      tool_calls: [],
      streamingComplete: false,
    };
    this.markMessage(fresh, 'add');
    cache.messages.push(fresh);
    return cache.messages[cache.messages.length - 1] as WritableDraft<RenderAssistantMessage>;
  }

  private handleThinkingChunk(cache: WritableDraft<ChatSessionCache>, chunk: ThinkingChunk) {
    const msg = this.getOrCreateAssistantDraft(cache, chunk.messageId, chunk.timestamp);
    msg.think += chunk.text;
    this.markMessage(msg as RenderAssistantMessage, 'update');
    cache.lastUpdated = Date.now();
  }

  private handleContentChunk(cache: WritableDraft<ChatSessionCache>, chunk: ContentChunk) {
    const msg = this.getOrCreateAssistantDraft(cache, chunk.messageId, chunk.timestamp);
    msg.content += chunk.text;
    this.markMessage(msg as RenderAssistantMessage, 'update');
    cache.lastUpdated = Date.now();
  }

  private handleToolCallChunk(cache: WritableDraft<ChatSessionCache>, chunk: ToolCallChunk) {
    const msg = this.getOrCreateAssistantDraft(cache, chunk.messageId, chunk.timestamp);
    while (msg.tool_calls.length <= chunk.index) {
      msg.tool_calls.push({ id: '', name: '', args: {}, time: chunk.time });
    }
    // 整体替换:主进程已发完整 args,renderer 不再做 string 累加。
    const existing = msg.tool_calls[chunk.index];
    msg.tool_calls[chunk.index] = {
      id: chunk.id,
      name: chunk.name,
      args: chunk.args,
      time: chunk.time,
      ...(existing.response ? { response: existing.response } : {}),
    };
    this.markMessage(msg as RenderAssistantMessage, 'update');
    cache.lastUpdated = Date.now();
  }

  private handleToolResultChunk(cache: WritableDraft<ChatSessionCache>, chunk: ToolResultChunk) {
    const response: ToolResult = {
      time: chunk.time,
      status: chunk.status,
      result: chunk.result,
      images: [],   // 渲染层不接收 tool 结果图片(只回灌给 LLM);保持 Domain 必填
    };
    // 倒着找最近一条带匹配 tool_call.id 的 assistant。Domain 模型保证 tool 结果
    // 一定属于 *上一条* assistant —— 但跨多 turn 的 retry 也可能命中更早 assistant,
    // 倒序兜底。
    for (let i = cache.messages.length - 1; i >= 0; i--) {
      const m = cache.messages[i];
      if (m.role !== 'assistant') continue;
      const tc = m.tool_calls.find((c) => c.id === chunk.toolCallId);
      if (!tc) continue;
      tc.response = response;
      this.markMessage(m as RenderAssistantMessage, 'update');
      cache.lastUpdated = Date.now();
      return;
    }
    logger.warn({
      msg: 'tool_result chunk could not locate assistant tool_call',
      toolCallId: chunk.toolCallId,
      toolName: chunk.toolName,
    });
  }

  private handleCompleteChunk(cache: WritableDraft<ChatSessionCache>, chunk: CompleteChunk) {
    const i = cache.messages.findIndex((m) => m.id === chunk.messageId);
    if (i === -1) return;
    const m = cache.messages[i];
    if (m.role !== 'assistant') return;
    m.streamingComplete = true;
    cache.streamingMessageId = null;
    this.markMessage(m as RenderAssistantMessage, 'update');
    cache.lastUpdated = Date.now();
  }

  handleInteractiveRequest(chatSessionId: string, data: PendingInteractiveRequest) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        session.pendingInteractiveRequests.push(data);
        session.lastUpdated = Date.now();
        data.task.finally(() => {
          this.handleInteractionProcessed(chatSessionId, data.id);
        });
      },
      'handleInteractiveRequest',
    );
    return result === 'updated';
  }

  private handleInteractionProcessed(chatSessionId: string, interactionId: string) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        const idx = session.pendingInteractiveRequests.findIndex((r) => r.id === interactionId);
        if (idx !== -1) {
          session.pendingInteractiveRequests.splice(idx, 1);
          session.lastUpdated = Date.now();
        }
      },
      'handleInteractionProcessed',
    );
    return result === 'updated';
  }

  getChatSessionCache(chatSessionId: string): ChatSessionCache | null {
    return this.chatSessionCaches[chatSessionId] ?? null;
  }

  getUserMessageSendState(chatSessionId: string | null | undefined): {
    canSend: boolean;
    error: string;
    chatStatus: string | null;
  } {
    if (!chatSessionId) {
      return { canSend: false, error: 'Cannot send a new message until chat status is ready.', chatStatus: null };
    }
    const chatStatus = this.getChatSessionCache(chatSessionId)?.chatStatus ?? null;
    if (chatStatus !== 'idle') {
      return {
        canSend: false,
        error: chatStatus
          ? `Cannot send a new message while chat status is ${chatStatus}.`
          : 'Cannot send a new message until chat status is ready.',
        chatStatus,
      };
    }
    return { canSend: true, error: '', chatStatus };
  }

  hasChatSessionCache(chatSessionId: string | null | undefined): boolean {
    return chatSessionId ? !!this.chatSessionCaches[chatSessionId] : false;
  }

  getAllChatSessionCaches(): Sessions {
    return this.chatSessionCaches;
  }

  replaceMessages(
    chatSessionId: string,
    messages: RenderMessage[],
    updates?: Partial<ChatSessionCache>,
  ) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        if (updates) Object.assign(session, updates);
        session.messages = messages;
        session.lastUpdated = Date.now();
      },
      'replaceMessages',
    );
    return result === 'updated';
  }

  /**
   * Set the Assistant Say Hi message. Used for frontend rendering only;
   * not included in the chat context and never sent to the backend.
   */
  setGreetingContent(chatSessionId: string, markdownContent: string | null) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        session.greetingContent = markdownContent?.trim() || null;
        session.lastUpdated = Date.now();
      },
      'setGreetingContent',
    );
    return result === 'updated';
  }

  setErrorMessage(chatSessionId: string, errorMessage: string) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        session.errorMessage = errorMessage;
        session.lastUpdated = Date.now();
      },
      'setErrorMessage',
    );
    return result === 'updated';
  }

  clearErrorMessage(chatSessionId: string) {
    const result = this.updateSession(
      chatSessionId,
      (session) => {
        session.errorMessage = null;
        session.lastUpdated = Date.now();
      },
      'clearErrorMessage',
    );
    return result === 'updated';
  }

  cleanup(): void {
    this.chatSessionCaches = {};
  }
}

// 一些消费者(history snapshot 路径)需要把 Domain Message[] 直接 lift 成
// RenderMessage[] 喂给 SessionManager。导出一个工具方便外部调用。
export { liftToRender };
