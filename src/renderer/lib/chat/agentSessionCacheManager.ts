// src/renderer/lib/chat/agentSessionCacheManager.ts
// Singleton chat-session cache manager for the frontend

import type { UserMessage } from '@shared/persist/types'
import { agentChatEvents } from '@/ipc/agentChat';
import { persistEvents } from '@/ipc/persist';
import { log } from '@/log';
import { external } from '@/atom/external';


import type { InteractiveMap } from '@shared/types/interactiveRequestTypes';
import { SessionManager, liftToRender } from './session-manager';
import type { ChatSessionCache, ChatStatus, PendingInteractiveRequest } from './session-manager';
import type { RenderMessage } from './renderMessage';
import { RenderItemsManager, type ChatRenderItem } from './render-items-manager';
import { onRequest } from '@shared/ipc/human-loop';
import Resolveable from '@shared/resolveable-promise';
import { CurrentSession } from '@/states/currentSession.atom';
import { agentIpc } from './agentIpc';
import { researchEvents } from '@/ipc/research';
const logger = log.child({ mod: 'AgentSessionCacheManager' });

export type {
  ChatSessionCache,
  ChatStatus,
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
type DirectMessageUpdateCallback = (message: RenderMessage, chatSessionId: string) => void;
type ChatSessionCacheLifecycleCallback = (chatSessionId: string) => void;

/**
 * AgentSessionCacheManager
 *
 * Responsibilities:
 * 1. Manage cache data for all ChatSessions (renderChatHistory, chatStatus, contextTokenUsage)
 * 2. Receive IPC event notifications from the backend AgentChatManager
 * 3. Provide cache data access and lifecycle subscriptions
 * 4. Combine cache updates with CurrentSession when exposing current-session selectors
 *
 * Active agent/job/session identity is owned by CurrentSession and written from the route.
 * This class owns session cache state only; it does not select the active route identity.
 */
class AgentSessionCacheManager {
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
    return AgentSessionCacheManager.instance ??= new AgentSessionCacheManager();
  }

  /**
   * Set up IPC listeners to receive notifications from the backend
   */
  private setupIpcListeners(): void {
    logger.debug({ msg: "Setting up IPC listeners" });

    // Listen for streaming chunks (handles content, tool_call, tool_result, complete, and status_changed)
    // 注：渲染端不再监听主进程推送的 current/cache 生命周期事件——
    // "哪个 session 活跃" 由路由直接写 CurrentSession；
    // "cache 数据" 由 ensureCache 主动 pull。
    const cleanupStreamingChunk = agentChatEvents.streamingChunk((_event, chunk) => {
      if (!chunk.chatSessionId) return;
      this.sessions.handleStreamingChunk(chunk.chatSessionId, chunk);
    });
    this.ipcCleanupFunctions.push(cleanupStreamingChunk);

    const cleanupScheduleRunUpdate = persistEvents['schedule:run:updated']((_event, payload) => {
      if (payload.status === 'running' || !this.sessions.hasChatSessionCache(payload.sessionId)) return;
      this.refreshJobRunCache(payload.agentId, payload.jobId, payload.sessionId);
    });

    const cleanupScheduleRunRemoved = persistEvents['schedule:run:removed']((_event, payload) => {
      this.sessions.handleChatSessionCacheDestroyed(payload.sessionId);
    });

    this.ipcCleanupFunctions.push(cleanupScheduleRunUpdate, cleanupScheduleRunRemoved);
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
   * Get the cache for a specific ChatSession
   */
  getChatSessionCache(chatSessionId: string): ChatSessionCache | null {
    return this.sessions.getChatSessionCache(chatSessionId);
  }

  getCurrentChatSessionCache(): ChatSessionCache | null {
    const id = CurrentSession.get().sessionId;
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

  /** 刷新已打开的 job run；静默运行不会经普通聊天的 streaming chunk 通道更新 cache。 */
  private async refreshJobRunCache(agentId: string, jobId: string, runId: string): Promise<void> {
    const snapshot = await agentIpc.loadJobRunSnapshot(agentId, jobId, runId);
    if (!snapshot || !this.sessions.hasChatSessionCache(runId)) return;

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
   * Non-React adapter for subscribing to CurrentSession.sessionId.
   * Invokes the callback immediately unless skipFirst is true. New callback consumers should
   * use CurrentSession.listen directly; React components should use CurrentSession.use().
   */
  subscribeToCurrentChatSessionId = (
    callback: (chatSessionId: string | null) => void,
    skipFirst = false,
  ): VoidFunction => {
    const unsub = CurrentSession.listen(() => {
      callback(CurrentSession.get().sessionId);
    });
    if (!skipFirst) {
      callback(CurrentSession.get().sessionId);
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
    CurrentSession.set({ agentId: null, jobId: null, sessionId: null });

    logger.debug({ msg: "✅ Cleanup completed, listeners preserved" });
  }
}


export const agentSessionCacheManager = AgentSessionCacheManager.getInstance();


// 订阅 current session 变化 + session cache 内容变化 的合成订阅。
// 用于那些"current session 的字段（status / error / messages 等）变了要重渲染"的场景。
const SubCurrentSession = external((update) => {
  const m = agentSessionCacheManager;
  const unsubSession = CurrentSession.listen(update);
  const unsubLifecycle = m.subscribeToChatSessionCacheLifecycle((id) => {
    if (id === CurrentSession.get().sessionId) update();
  });
  return () => {
    unsubSession();
    unsubLifecycle();
  };
});

export const CurrentSessionStatus = SubCurrentSession(() => {
  const { sessionId: id, agentId } = CurrentSession.get();
  if (id) {
    const cache = agentSessionCacheManager.getChatSessionCache(id);
    if (cache) {
      const { agentId, chatSessionId, chatStatus } = cache;
      return { agentId, chatSessionId, chatStatus };
    }
  }
  return { agentId, chatSessionId: id || undefined, chatStatus: 'idle' as const };
}, (prev, next) => {
  // session id 相同时，chat id 一定相同
  return prev.chatSessionId === next.chatSessionId && prev.chatStatus === next.chatStatus;
});


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
