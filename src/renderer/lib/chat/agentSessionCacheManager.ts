// src/renderer/lib/chat/agentSessionCacheManager.ts
// Singleton chat-session state manager for the frontend

import { useState, useEffect } from 'react';
import type { UserMessage } from '@shared/persist/types'
import { agentChatEvents } from '@/ipc/agentChat';
import { log } from '@/log';
import { external } from '@/atom/external';

import type { InteractiveMap } from '@shared/types/interactiveRequestTypes';
import { SessionManager, liftToRender } from './session-manager';
import type { ChatSessionCache, ChatStatus, PendingInteractiveRequest } from './session-manager';
import type { RenderMessage } from './renderMessage';
import { RenderItemsManager, type ChatRenderItem } from './render-items-manager';
import { onRequest } from '@shared/ipc/human-loop';
import Resolveable from '@shared/resolveable-promise';
import { currentSessionStore, useCurrentSession } from '@/states/currentSession.atom';
import { agentIpc } from './agentIpc';
import { researchEvents } from '@/ipc/research';
const logger = log.child({ mod: 'AgentSessionCacheManager' });

export type {
  ChatSessionCache,
  ChatStatus,
  PendingInteractiveRequest,
}

/**
 * CachedFilePath interface - cached file path information
 * Contains the file path and whether it exists.
 */
export interface CachedFilePath {
  /** File path */
  path: string;
  /** Whether the file exists */
  exists: boolean;
}


interface Sessions {
  [id: string]: ChatSessionCache | undefined;
}
/**
 * Direct callback type - used for real-time streaming updates.
 * Invoked synchronously in the same call stack with no async delay.
 */
export type DirectMessageUpdateCallback = (message: RenderMessage, chatSessionId: string) => void;
export type ChatSessionCacheLifecycleCallback = (chatSessionId: string) => void;
export type AfterSessionUpdated = (next: ChatSessionCache) => void;

/**
 * AgentSessionCacheManager
 *
 * Responsibilities:
 * 1. Manage currentAgentId and currentChatSessionId
 * 2. Manage cache data for all ChatSessions (renderChatHistory, chatStatus, contextTokenUsage)
 * 3. Receive IPC event notifications from the backend AgentChatManager
 * 4. Provide a unified data-access interface and change-subscription mechanism
 *
 * This is the sole place on the frontend that manages these states.
 */
export class AgentSessionCacheManager {
  private static instance: AgentSessionCacheManager;

  private sessions = new SessionManager();
  private renderItems = new RenderItemsManager(this.sessions);

  // Direct callback management - fix: use Set to support multiple callbacks
  private directMessageUpdateCallbacks: Map<string, Set<DirectMessageUpdateCallback>> = new Map();
  private chatSessionCacheLifecycleCallbacks: Set<ChatSessionCacheLifecycleCallback> = new Set();

  // IPC event cleanup functions
  private ipcCleanupFunctions: Array<() => void> = [];

  private constructor() {
    this.setupIpcListeners();
    this.ipcCleanupFunctions.push(
      this.sessions.onMessageChange((msg, session) => {
        const set = this.directMessageUpdateCallbacks.get(session.chatSessionId);
        if (!set) return;
        const last = msg[msg.length - 1];
        if (set) set.forEach(f => f(last.message, session.chatSessionId));
      }),
    );

    const sids = new Set<string>();
    const emit = () => {
      sids.forEach(id => this.notifyChatSessionCacheLifecycleCallbacks(id));
      sids.clear();
    };
    this.ipcCleanupFunctions.push(
      this.sessions.onSessionChange((session) => {
        if (sids.size === 0) setTimeout(emit, 0);
        sids.add(session.chatSessionId);
      }),
    );
  }

  static getInstance(): AgentSessionCacheManager {
    if (!AgentSessionCacheManager.instance) {
      AgentSessionCacheManager.instance = new AgentSessionCacheManager();
    }
    return AgentSessionCacheManager.instance;
  }

  /**
   * Set up IPC listeners to receive notifications from the backend
   */
  private setupIpcListeners(): void {
    logger.debug({ msg: "Setting up IPC listeners" });

    // Listen for streaming chunks (handles content, tool_call, tool_result, complete, and status_changed)
    // 注：渲染端不再监听主进程推送的 current/cache 生命周期事件——
    // "哪个 session 活跃" 由路由直接写 currentSessionStore；
    // "cache 数据" 由 ensureCache 主动 pull。
    const cleanupStreamingChunk = agentChatEvents.streamingChunk(
      (_event, chunk) => {
        if (chunk.chatSessionId) {
          this.sessions.handleStreamingChunk(chunk.chatSessionId, chunk);
        }
      }
    );
    this.ipcCleanupFunctions.push(cleanupStreamingChunk);
  }


  /**
   * Add a user message to the messages array.
   * No longer creates a ChatTurn; appends directly to the flat message list.
   */
  addUserMessage(chatSessionId: string, userMessage: UserMessage): void {
    this.sessions.addUserMessage(chatSessionId, userMessage);
  }

  removeMessage(chatSessionId: string, messageId: string): void {
    this.sessions.removeMessage(chatSessionId, messageId);
  }


  // ========== Public API Methods ==========

  /**
   * Get the current AgentId
   */
  getCurrentAgentId = (): string | null => {
    return currentSessionStore.get().agentId;
  };

  /**
   * Get the current ChatSessionId
   */
  getCurrentChatSessionId = (): string | null => {
    return currentSessionStore.get().chatSessionId;
  };

  /**
   * Get the cache for a specific ChatSession
   */
  getChatSessionCache(chatSessionId: string): ChatSessionCache | null {
    return this.sessions.getChatSessionCache(chatSessionId);
  }

  getCurrentChatSessionCache(): ChatSessionCache | null {
    const id = currentSessionStore.get().chatSessionId;
    if (!id) return null;
    return this.sessions.getChatSessionCache(id);
  }

  getUserMessageSendState(chatSessionId: string | null | undefined): {
    canSend: boolean;
    error: string;
    chatStatus: string | null;
  } {
    return this.sessions.getUserMessageSendState(chatSessionId);
  }

  /**
   * Wait until a session cache is ready to send (chatStatus === 'idle'), up to timeoutMs.
   * Resolves true when ready, false on timeout.
   */
  waitForSendReady(chatSessionId: string, timeoutMs = 5000): Promise<boolean> {
    // Already ready?
    if (this.getUserMessageSendState(chatSessionId).canSend) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);

      const unsubscribe = this.subscribeToChatSessionCacheLifecycle((id) => {
        if (id === chatSessionId && this.getUserMessageSendState(chatSessionId).canSend) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  hasChatSessionCache(chatSessionId: string | null | undefined): boolean {
    return this.sessions.hasChatSessionCache(chatSessionId);
  }

  /**
   * Get all ChatSession caches
   */
  getAllChatSessionCaches(): Sessions {
    return this.sessions.getAllChatSessionCaches();
  }

  getRenderItemsManager(): RenderItemsManager {
    return this.renderItems;
  }

  /**
   * Manually create a ChatSession cache (for frontend-initiated creation)
   */
  createChatSessionCache(chatSessionId: string, agentId: string, initialData?: Partial<ChatSessionCache>): void {
    if (this.sessions.hasChatSessionCache(chatSessionId)) {
      logger.warn({ msg: "Cache already exists:", data: chatSessionId });
      return;
    }
    this.sessions.handleChatSessionCacheCreated(chatSessionId, agentId, initialData);
  }

  /**
   * Regular session cache 入口。路由 `/agent/:agentId/:sessionId` 切换或冷启动时调用。
   * 走 `loadChatSessionSnapshot` IPC，仅服务 regular 形态。
   * Schedule run 形态请用 `ensureJobRunCache`。
   */
  async ensureCache(agentId: string, chatSessionId: string): Promise<void> {
    if (this.sessions.hasChatSessionCache(chatSessionId)) return;

    // 插入空骨架，先让 UI 有东西可订阅
    this.sessions.handleChatSessionCacheCreated(chatSessionId, agentId);

    const snapshot = await agentIpc.loadChatSessionSnapshot(agentId, chatSessionId);
    if (!snapshot) return;

    // 重新调用 handleChatSessionCacheCreated 触发合并逻辑（已有
    // mergeSnapshotMessagesWithExistingCache 处理冲突）
    this.sessions.handleChatSessionCacheCreated(chatSessionId, agentId, {
      messages: snapshot.messages.map(liftToRender),
      chatStatus: snapshot.chatStatus as ChatStatus,
      contextTokenUsage: snapshot.contextTokenUsage,
      // 主进程透 `interrupted` 语义,文案在此本地化。Domain 层不藏 UI 文字。
      errorMessage: snapshot.interrupted ? '上次会话异常中断,请点击 Retry 重试。' : null,
    });
  }

  /**
   * Job run cache 入口。路由 `/agent/:agentId/job/:jobId/:sessionId` 切换时调用。
   * 走 `loadJobRunSnapshot` IPC，与 regular 物理隔离。Cache 本身仍按 sessionId
   * 索引（同一份 in-memory 容器），区别只在 snapshot 来源。
   */
  async ensureJobRunCache(agentId: string, jobId: string, runId: string): Promise<void> {
    if (this.sessions.hasChatSessionCache(runId)) return;

    // 插入空骨架，先让 UI 有东西可订阅
    this.sessions.handleChatSessionCacheCreated(runId, agentId);

    const snapshot = await agentIpc.loadJobRunSnapshot(agentId, jobId, runId);
    if (!snapshot) return;

    this.sessions.handleChatSessionCacheCreated(runId, agentId, {
      messages: snapshot.messages.map(liftToRender),
      chatStatus: snapshot.chatStatus as ChatStatus,
      contextTokenUsage: snapshot.contextTokenUsage,
    });
  }

  replaceMessages(chatSessionId: string, messages: RenderMessage[], updates?: Partial<ChatSessionCache>): void {
    this.sessions.replaceMessages(chatSessionId, messages, updates);
  }

  addInteractiveRequest(chatSessionId: string, request: PendingInteractiveRequest) {
    this.sessions.handleInteractiveRequest(chatSessionId, request);
  }

  // ========== Callback Management ==========

  registerDirectMessageUpdateCallback(
    chatSessionId: string,
    callback: DirectMessageUpdateCallback
  ): () => void {
    // Fix: use Set to support multiple callbacks
    let callbackSet = this.directMessageUpdateCallbacks.get(chatSessionId);
    if (!callbackSet) {
      callbackSet = new Set();
      this.directMessageUpdateCallbacks.set(chatSessionId, callbackSet);
    }
    callbackSet.add(callback);
    logger.debug({ msg: "Registered direct callback", chatSessionId, total: callbackSet.size });

    return () => {
      const set = this.directMessageUpdateCallbacks.get(chatSessionId);
      if (set) {
        set.delete(callback);
        logger.debug({ msg: "Unregistered direct callback", chatSessionId, remaining: set.size });
        if (set.size === 0) {
          this.directMessageUpdateCallbacks.delete(chatSessionId);
        }
      }
    };
  }

  subscribeToChatSessionCacheLifecycle(callback: ChatSessionCacheLifecycleCallback): () => void {
    this.chatSessionCacheLifecycleCallbacks.add(callback);
    return () => {
      this.chatSessionCacheLifecycleCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to current chat session changes.
   * Thin wrapper over currentSessionStore — kept for backwards compatibility with
   * existing consumers (StatusBadges / ContextBadge / SessionPanel / ComposeInput / ...).
   * Prefer reading from `useCurrentSession` / `useCurrentChatSessionId` directly in new code.
   */
  subscribeToCurrentChatSessionId = (
    callback: (chatSessionId: string | null) => void,
    skipFirst = false,
  ): VoidFunction => {
    const unsub = currentSessionStore.subscribe(() => {
      callback(currentSessionStore.get().chatSessionId);
    });
    if (!skipFirst) {
      callback(currentSessionStore.get().chatSessionId);
    }
    return unsub;
  };

  private notifyChatSessionCacheLifecycleCallbacks(chatSessionId: string): void {
    this.chatSessionCacheLifecycleCallbacks.forEach(callback => {
      try {
        callback(chatSessionId);
      } catch (error) {
        logger.error({ msg: "Error in cache lifecycle callback:", err: error });
      }
    });
  }

  // ========== Error Message Methods ==========

  /**
   * Set the error message for a ChatSession.
   * Used to display an error in the ErrorBar.
   */
  setErrorMessage(chatSessionId: string, errorMessage: string): void {
    this.sessions.setErrorMessage(chatSessionId, errorMessage);
  }

  /**
   * Clear the error message for a ChatSession.
   * Called when the user clicks Retry or the error has been handled.
   */
  clearErrorMessage(chatSessionId: string): void {
    this.sessions.clearErrorMessage(chatSessionId);
  }

  // ========== Cleanup Methods ==========

  /**
   * Clean up all caches and listeners.
   * Important fix: on logout, only clear cache data; retain IPC listeners and React subscriptions
   * so that a new user can still receive backend messages and update the UI after logging in.
   */
  cleanup(): void {
    logger.debug({ msg: "Cleaning up" });

    // Clear all session cache data
    this.sessions.cleanup();
    this.renderItems.clearCaches();
    // Reset the current session (atom) so React components re-render to a clean state.
    currentSessionStore.set({ agentId: null, chatSessionId: null });

    logger.debug({ msg: "✅ Cleanup completed, listeners preserved" });
  }
}

// extractFilePathsFromText 已迁到独立叶子模块,见 ./extractFilePaths.ts。
// 此处保留 re-export 以维持外部导入兼容(`ChatContainer` 等)。
export { extractFilePathsFromText } from './extractFilePaths';

export const agentSessionCacheManager = AgentSessionCacheManager.getInstance();
const manager = agentSessionCacheManager;

export function useCurrentChatSessionId(): string | null {
  return useCurrentSession().chatSessionId;
}

export function useHasChatSessionCache(chatSessionId?: string | null): boolean {
  const [hasCache, setHasCache] = useState<boolean>(() => manager.hasChatSessionCache(chatSessionId));

  useEffect(() => {
    setHasCache(manager.hasChatSessionCache(chatSessionId));
    if (!chatSessionId) return;

    return manager.subscribeToChatSessionCacheLifecycle((changedChatSessionId) => {
      if (changedChatSessionId !== chatSessionId) return;
      setHasCache(manager.hasChatSessionCache(chatSessionId));
    });
  }, [chatSessionId, manager]);

  return hasCache;
}

/**
 * Reactive hook: get the current agentId (agent ID).
 * Automatically re-renders the component when currentAgentId changes.
 *
 * Note: currentAgentId and currentChatSessionId always change together
 * (both updated in handleCurrentChatSessionIdChanged),
 * so we can reuse subscribeToCurrentChatSessionId to watch agentId changes.
 */
export function useCurrentAgentId(): string | null {
  return useCurrentSession().agentId;
}

// 订阅 current session 变化 + session cache 内容变化 的合成订阅。
// 用于那些"current session 的字段（status / error / messages 等）变了要重渲染"的场景。
const SubCurrentSession = external((update) => {
  const m = agentSessionCacheManager;
  const unsubSession = currentSessionStore.subscribe(update);
  const unsubLifecycle = m.subscribeToChatSessionCacheLifecycle((id) => {
    if (id === currentSessionStore.get().chatSessionId) update();
  });
  return () => {
    unsubSession();
    unsubLifecycle();
  };
});

export const CurrentSessionStatus = SubCurrentSession(() => {
  const id = agentSessionCacheManager.getCurrentChatSessionId();
  if (id) {
    const cache = agentSessionCacheManager.getChatSessionCache(id);
    if (cache) {
      const { agentId, chatSessionId, chatStatus } = cache;
      return { agentId, chatSessionId, chatStatus };
    }
  }
  return {
    agentId: agentSessionCacheManager.getCurrentAgentId() || undefined,
    chatSessionId: id || undefined,
    chatStatus: 'idle' as const,
  };
}, (prev, next) => {
  // session id 相同时，chat id 一定相同
  return prev.chatSessionId === next.chatSessionId && prev.chatStatus === next.chatStatus;
});

export function useStreamingMessageId(): string | null {
  const currentSessionId = useCurrentChatSessionId();
  if (!currentSessionId) {
    return null;
  }
  const cache = manager.getChatSessionCache(currentSessionId);
  return cache?.streamingMessageId || null;
}

const SubCurrentSid = external(currentSessionStore.subscribe);

export const CurrentSessionError = SubCurrentSid(() => {
  const cache = agentSessionCacheManager.getCurrentChatSessionCache();
  return cache?.errorMessage || null;
});

const EMPTY_REQUESTS: PendingInteractiveRequest[] = [];
export const CurrentSessionInteractiveRequests = SubCurrentSession(() => {
  const cache = agentSessionCacheManager.getCurrentChatSessionCache();
  return cache?.pendingInteractiveRequests ?? EMPTY_REQUESTS;
});

const EMPTY_TOKEN_USAGE = { tokenCount: 0, totalMessages: 0, contextMessages: 0, compressionRatio: 1.0 };
export const CurrentSessionTokenUsage = SubCurrentSession(() => {
  const cache = agentSessionCacheManager.getCurrentChatSessionCache();
  return cache?.contextTokenUsage ?? EMPTY_TOKEN_USAGE;
}, (prev, next) => prev.tokenCount === next.tokenCount);

export const { useMessages, useMessagesWithStream } = (() => {
  const EMPTY_MESSAGES: RenderMessage[] = [];
  const EMPTY_WITH_STREAM = { messages: EMPTY_MESSAGES, streamingMessageId: undefined as string | undefined };

  const { use: useMessages } = SubCurrentSession(() => {
    const cache = agentSessionCacheManager.getCurrentChatSessionCache();
    return cache?.messages ?? EMPTY_MESSAGES;
  });

  const { use: useMessagesWithStream } = SubCurrentSession(() => {
    const session = agentSessionCacheManager.getCurrentChatSessionCache();
    if (session) {
      const { messages, streamingMessageId: id } = session;
      return { messages, streamingMessageId: id || undefined };
    }
    return EMPTY_WITH_STREAM;
  }, (prev, next) => {
    return prev.streamingMessageId === next.streamingMessageId && prev.messages === next.messages;
  });

  return { useMessages, useMessagesWithStream };
})();

const EMPTY_RENDER_ITEMS: ChatRenderItem[] = [];

export function getRenderItems(chatSessionId: string | null | undefined): ChatRenderItem[] {
  if (!chatSessionId) return EMPTY_RENDER_ITEMS;
  return agentSessionCacheManager.getRenderItemsManager().getRenderItems(chatSessionId);
}

onRequest('approval', (request, id) => {
  const cid = request.chatSessionId;
  const task = new Resolveable<InteractiveMap['approval']['out']>();
  agentSessionCacheManager.addInteractiveRequest(cid, { type: 'approval', id, request, task });
  return task;
});
onRequest('choice', (request, id) => {
  const cid = request.chatSessionId;
  const task = new Resolveable<InteractiveMap['choice']['out']>();
  agentSessionCacheManager.addInteractiveRequest(cid, { type: 'choice', id, request, task });
  return task;
});
onRequest('form', (request, id) => {
  const cid = request.chatSessionId;
  const task = new Resolveable<InteractiveMap['form']['out']>();
  agentSessionCacheManager.addInteractiveRequest(cid, { type: 'form', id, request, task });
  return task;
});
onRequest('device-auth', (request, id) => {
  const cid = request.chatSessionId;
  const task = new Resolveable<InteractiveMap['device-auth']['out']>();
  agentSessionCacheManager.addInteractiveRequest(cid, { type: 'device-auth', id, request, task });
  return task;
});
onRequest('interactive-search', (request, id) => {
  const cid = request.chatSessionId;
  const task = new Resolveable<InteractiveMap['interactive-search']['out']>();
  const cleanupCompleted = researchEvents.completed((_event, payload) => {
    if (payload.requestId === id && task.isPending) {
      task.resolve(payload.response);
    }
  });
  task.finally(cleanupCompleted).catch(() => undefined);
  agentSessionCacheManager.addInteractiveRequest(cid, { type: 'interactive-search', id, request, task });
  return task;
});
