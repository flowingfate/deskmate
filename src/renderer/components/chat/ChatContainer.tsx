import React, { useRef, useEffect, useCallback, memo, useMemo, useState, useLayoutEffect, useReducer } from 'react';
import type { RenderMessage } from '@/lib/chat/renderMessage';
import { fsApi } from '@/ipc/fs';
import { type ChatStatus, getRenderItems } from '../../lib/chat/agentSessionCacheManager';
import './ChatContainer.scss';
import { useToast } from '../ui/ToastProvider';
import { EditingMessageState, editMessageAtom } from './message/edit-message.atom';
import { getChatRenderItemStableKey, isVisibleChatRenderItem, ChatRenderItemComponent, type ChatRenderItem, hasTextContent } from './ChatRenderItem';
import { GreetingMessage } from './message/GreetingMessage';
import { Button } from '@/shadcn/button';

interface ChatContainerProps {
  messages: RenderMessage[];
  streamingMessageId?: string; // ID of the message currently being streamed
  agentId?: string;
  chatSessionId?: string;
  chatStatus?: ChatStatus;
  editingMessage?: EditingMessageState | null;
  canEditUserMessage?: boolean;
}

const FOLLOW_LATEST_THRESHOLD_PX = 40;

function useAutoScroll(
  chatSessionId: string | null | undefined,
  messages: RenderMessage[],
  streamingMessageId: string | undefined,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messageFlowRef = useRef<HTMLDivElement>(null);
  const previousChatSessionIdRef = useRef<string | null | undefined>(undefined);
  const previousMessageCountRef = useRef<number | null>(null);
  const latestScrollFrameRef = useRef<number | null>(null);
  const trailingLatestScrollFrameRef = useRef<number | null>(null);
  const latestScrollTimeoutRef = useRef<number | null>(null);
  const latestScrollStabilizeUntilRef = useRef(0);
  const userScrolledAwayRef = useRef(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const latestMessageRole = messages[messages.length - 1]?.role;

  const handleContainerScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distanceFromLatest =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const scrolledAway = distanceFromLatest > FOLLOW_LATEST_THRESHOLD_PX;
    userScrolledAwayRef.current = scrolledAway;
    setShowJumpToLatest((prev) => (prev === scrolledAway ? prev : scrolledAway));
  }, []);

  const scrollToLatestPosition = useCallback((reason: string, options?: { force?: boolean }) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Respect user's reading position: if they scrolled up, don't drag them back.
    // Forced calls (session change, new user message, interactive request) override this.
    if (!options?.force && userScrolledAwayRef.current) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, []);

  const openLatestScrollStabilizationWindow = useCallback(() => {
    latestScrollStabilizeUntilRef.current = Date.now() + 1500;
  }, []);

  const isWithinLatestScrollStabilizationWindow = useCallback(() => {
    return Date.now() <= latestScrollStabilizeUntilRef.current;
  }, []);

  const clearPendingLatestScroll = useCallback(() => {
    if (latestScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(latestScrollFrameRef.current);
      latestScrollFrameRef.current = null;
    }

    if (trailingLatestScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(trailingLatestScrollFrameRef.current);
      trailingLatestScrollFrameRef.current = null;
    }

    if (latestScrollTimeoutRef.current !== null) {
      window.clearTimeout(latestScrollTimeoutRef.current);
      latestScrollTimeoutRef.current = null;
    }
  }, []);

  const scheduleLatestScroll = useCallback((options?: { force?: boolean }) => {
    if (options?.force) {
      userScrolledAwayRef.current = false;
      setShowJumpToLatest(false);
    }

    openLatestScrollStabilizationWindow();
    clearPendingLatestScroll();
    scrollToLatestPosition('immediate', options);

    latestScrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollToLatestPosition('raf-1', options);
      latestScrollFrameRef.current = null;

      trailingLatestScrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollToLatestPosition('raf-2', options);
        trailingLatestScrollFrameRef.current = null;
      });
    });

    latestScrollTimeoutRef.current = window.setTimeout(() => {
      scrollToLatestPosition('timeout-180ms', options);
      latestScrollTimeoutRef.current = null;
    }, 180);
  }, [clearPendingLatestScroll, openLatestScrollStabilizationWindow, scrollToLatestPosition]);

  const handleJumpToLatestClick = useCallback(() => {
    scheduleLatestScroll({ force: true });
    setShowJumpToLatest(false);
  }, [scheduleLatestScroll]);

  // Scroll to the latest message only for the initial load, session changes, or appended messages.
  // This avoids viewport jumps during ordinary UI-only rerenders such as entering inline edit mode.
  useEffect(() => {
    const previousChatSessionId = previousChatSessionIdRef.current;
    const previousMessageCount = previousMessageCountRef.current;
    const currentChatSessionId = chatSessionId ?? null;
    const isFirstRender = previousMessageCount === null;
    const didChatSessionChange = currentChatSessionId !== previousChatSessionId;
    const didMessageCountIncrease = previousMessageCount !== null && messages.length > previousMessageCount;
    const shouldForceLatestScroll = isFirstRender || didChatSessionChange || latestMessageRole === 'user';

    if (messages.length > 0 && (isFirstRender || didChatSessionChange || didMessageCountIncrease)) {
      scheduleLatestScroll({ force: shouldForceLatestScroll });
    }

    previousChatSessionIdRef.current = currentChatSessionId;
    previousMessageCountRef.current = messages.length;
    return clearPendingLatestScroll;
  }, [chatSessionId, clearPendingLatestScroll, latestMessageRole, messages.length, scheduleLatestScroll]);

  // 流式期间消息数量不变（同一条 assistant 追加内容），messageCount effect 不会触发；
  // 这里独立监听 streaming message 的文本长度变化，每个 chunk 都顺势触发跟随滚动。
  const streamingMessageTextLength = useMemo(() => {
    if (!streamingMessageId) return 0;
    const msg = messages.find((m) => m.id === streamingMessageId);
    if (!msg || msg.role !== 'assistant') return 0;
    // Domain assistant.content / .think 是单串;长度直接累加
    return msg.content.length + msg.think.length;
  }, [messages, streamingMessageId]);

  useEffect(() => {
    if (!streamingMessageId || streamingMessageTextLength === 0) return;
    scheduleLatestScroll();
  }, [streamingMessageId, streamingMessageTextLength, scheduleLatestScroll]);

  useEffect(() => {
    const observedFlow = messageFlowRef.current;
    if (!observedFlow || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!isWithinLatestScrollStabilizationWindow()) {
        return;
      }

      scrollToLatestPosition('resize-observer');
    });

    observer.observe(observedFlow);

    return () => {
      observer.disconnect();
    };
  }, [isWithinLatestScrollStabilizationWindow, scrollToLatestPosition]);

  return {
    containerRef,
    messageFlowRef,
    showJumpToLatest,
    handleContainerScroll,
    handleJumpToLatestClick,
    isWithinLatestScrollStabilizationWindow,
    scrollToLatestPosition,
  };
}

async function hasFile(p: string) {
  try {
    if (fsApi) {
      return await fsApi.exists(p);
    }
    return false;
  } catch {
    return false;
  }
}

function useFileExistsCache(
  renderItems: ChatRenderItem[],
  agentId: string | undefined
) {
  // File path existence cache: key = filePath, value = exists
  const [fileExistsCache, setFileExistsCache] = useState<Record<string, boolean>>({});

  // Clear file exists cache when chat session changes so files are re-checked
  useEffect(() => {
    setFileExistsCache({});
  }, [agentId]);

  // Asynchronously check whether extracted file paths from assistant messages exist on disk
  useEffect(() => {
    const all = new Set<string>();
    renderItems.forEach(item => {
      if (item.type === 'assistant' && item.extractedFilePaths) {
        item.extractedFilePaths.forEach(p => all.add(p));
      }
    });

    // Find paths that have not yet been checked
    const unchecked = [...all].filter(p => !(p in fileExistsCache));
    if (unchecked.length === 0) return;

    let cancelled = false;
    let retryTimer = 0;

    (async () => {
      const results: Record<string, boolean> = {};
      const missing: string[] = [];
      await Promise.all(
        unchecked.map(async (filePath) => {
          const exists = await hasFile(filePath);
          results[filePath] = exists;
          if (!exists) missing.push(filePath);
        })
      );
      if (cancelled) return;
      setFileExistsCache(prev => ({ ...prev, ...results }));
      if (missing.length === 0) return;
      retryTimer = window.setTimeout(async () => {
        if (cancelled) return;
        const retryResults: Record<string, boolean> = {};
        await Promise.allSettled(
          missing.map(async (filePath) => {
            retryResults[filePath] = await fsApi.exists(filePath);
          })
        );
        if (!cancelled && Object.keys(retryResults).length > 0) {
          setFileExistsCache(prev => ({ ...prev, ...retryResults }));
        }
      }, 2000);
    })();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [renderItems]);

  return fileExistsCache;
}

function useActivitySlot(
  renderItems: ChatRenderItem[],
  streamingMessageId: string | undefined,
  chatStatus: ChatContainerProps['chatStatus'],
  messages: RenderMessage[],
) {
  const previousVisibleRenderItemsLengthRef = useRef(0);
  const previousLatestVisibleRenderItemKeyRef = useRef<string>('none');
  const previousHadActivitySlotRef = useRef(false);
  const forceUpdate = useReducer((x) => x + 1, 0)[1];

  const shouldShowLoading = chatStatus === 'compressed_context' || chatStatus === 'compressing_context' || chatStatus === 'sending_response';

  // Watch window visibility changes to ensure the loading indicator re-renders after the window regains focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && shouldShowLoading) forceUpdate();
    };

    const handleFocus = () => {
      if (shouldShowLoading) forceUpdate();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [shouldShowLoading]);

  // Check whether a top-level loading indicator should be shown
  const shouldShowTopLevelLoading = useCallback(() => {
    const hasMessages = renderItems.length > 0;
    const hasUserMessage = renderItems.some(item => item.type === 'user');

    // Show at top if there are no messages (or no user messages) while loading
    return shouldShowLoading && (!hasMessages || !hasUserMessage);
  }, [renderItems, shouldShowLoading]);

  // Determine whether the boundary container should be rendered
  const shouldShowBoundaryContainer = useCallback(() => {
    return shouldShowTopLevelLoading() || messages.length > 0;
  }, [shouldShowTopLevelLoading, messages.length]);

  // Check if loading indicator should be shown after last message
  // Fix: In agentic loop, show loading before each assistant message starts streaming
  const shouldShowLoadingAfterLastMessage = useCallback(() => {
    if (!shouldShowLoading) return false;

    // Fix: Check if an assistant message is currently streaming by looking up the message role
    // Find the streaming message in allMessages by its ID
    if (streamingMessageId) {
      const streamingMessage = messages.find(msg => msg.id === streamingMessageId);
      if (streamingMessage && streamingMessage.role === 'assistant') {
        // An assistant message is streaming, no need for loading indicator
        return false;
      }
    }

    // No assistant message is streaming, show loading if chatStatus indicates waiting for response
    return true;
  }, [shouldShowLoading, streamingMessageId, messages]);

  const shouldReserveActivitySlotAfterHide = useCallback(() => {
    if (!streamingMessageId) {
      return false;
    }

    const streamingMessage = messages.find(msg => msg.id === streamingMessageId);
    if (!streamingMessage || streamingMessage.role !== 'assistant') {
      return false;
    }

    const hasVisibleAssistantText = hasTextContent(streamingMessage);
    const hasVisibleToolCalls = streamingMessage.tool_calls.some((tc) => {
      const id = tc.id.trim();
      const name = tc.name.trim();
      return Boolean(id || name);
    });

    return !hasVisibleAssistantText && !hasVisibleToolCalls;
  }, [streamingMessageId, messages]);

  const visibleRenderItems = useMemo(() => {
    return renderItems.filter(isVisibleChatRenderItem);
  }, [renderItems]);

  const latestVisibleRenderItemKey = useMemo(() => {
    return getChatRenderItemStableKey(visibleRenderItems[visibleRenderItems.length - 1]);
  }, [visibleRenderItems]);

  const shouldKeepStickyActivitySlot = useMemo(() => {
    if (shouldShowTopLevelLoading() || shouldShowLoadingAfterLastMessage() || shouldReserveActivitySlotAfterHide()) {
      return false;
    }

    if (!previousHadActivitySlotRef.current) {
      return false;
    }

    return previousVisibleRenderItemsLengthRef.current === visibleRenderItems.length &&
      previousLatestVisibleRenderItemKeyRef.current === latestVisibleRenderItemKey;
  }, [latestVisibleRenderItemKey, shouldReserveActivitySlotAfterHide, shouldShowLoadingAfterLastMessage, shouldShowTopLevelLoading, visibleRenderItems.length]);

  const renderItemsWithActivity = useMemo<ChatRenderItem[]>(() => {
    if (shouldShowTopLevelLoading()) {
      return renderItems;
    }

    const activityType = shouldShowLoadingAfterLastMessage()
      ? 'activity-loading'
      : shouldReserveActivitySlotAfterHide()
        ? 'activity-placeholder'
        : shouldKeepStickyActivitySlot
          ? 'activity-placeholder'
          : null;

    if (!activityType) {
      return renderItems;
    }

    return [
      ...renderItems,
      {
        type: activityType,
        index: renderItems.length,
        sectionKey: `chat-${activityType}`,
      },
    ];
  }, [renderItems, shouldKeepStickyActivitySlot, shouldShowTopLevelLoading, shouldShowLoadingAfterLastMessage, shouldReserveActivitySlotAfterHide]);

  useEffect(() => {
    previousVisibleRenderItemsLengthRef.current = visibleRenderItems.length;
    previousLatestVisibleRenderItemKeyRef.current = latestVisibleRenderItemKey;
    previousHadActivitySlotRef.current = renderItemsWithActivity.some(
      item => item.type === 'activity-loading' || item.type === 'activity-placeholder'
    );
  }, [latestVisibleRenderItemKey, renderItemsWithActivity, visibleRenderItems.length]);

  return {
    renderItemsWithActivity,
    shouldShowTopLevelLoading,
    shouldShowBoundaryContainer,
  };
}

const ChatContainerInner: React.FC<ChatContainerProps> = ({
  messages,
  streamingMessageId,
  agentId,
  chatSessionId,
  chatStatus,
  editingMessage,
  canEditUserMessage,
}) => {
  const {
    containerRef,
    messageFlowRef,
    showJumpToLatest,
    handleContainerScroll,
    handleJumpToLatestClick,
    isWithinLatestScrollStabilizationWindow,
    scrollToLatestPosition,
  } = useAutoScroll(chatSessionId, messages, streamingMessageId);

  // Build render items from the data-layer RenderItemsManager (pre-computed, not derived per render)
  const renderItems = getRenderItems(chatSessionId);
  const fileExistsCache = useFileExistsCache(renderItems, agentId);
  const {
    renderItemsWithActivity,
    shouldShowTopLevelLoading,
    shouldShowBoundaryContainer,
  } = useActivitySlot(renderItems, streamingMessageId, chatStatus, messages);

  const toast = useToast();
  const editMessageActions = editMessageAtom.useChange();
  const handleStartEdit = useCallback((messageId: string) => {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) return;
    const message = messages[index];

    function checkTool(name?: string) {
      if (!name) return;
      const normalized = name.toLowerCase();
      return [
        'write', 'edit', 'update', 'modify', 'delete', 'remove', 'move', 'rename', 'copy', 'create',
        'install', 'execute', 'run', 'send', 'approve', 'apply', 'commit', 'publish',
      ].some((keyword) => normalized.includes(keyword));
    }

    function warning() {
      for (let i = index + 1; i < messages.length; i += 1) {
        const item = messages[i];
        if (item.role === 'assistant' && item.tool_calls.some((tc) => checkTool(tc.name))) {
          return 'Regenerating will not undo external actions that were already executed.';
        }
      }
      return null;
    }

    editMessageActions.start(chatSessionId!, index, message, warning(), toast);
  }, [chatSessionId, messages, toast]);

  const isCompressing = chatStatus === 'compressing_context';
  const renderLoadingIndicator = useCallback((className?: string) => {
    let loadingText = '';
    if (isCompressing) {
      loadingText = 'Compressing...';
    }

    if (loadingText) {
      return (
        <div className={`loading-text ${className || ''}`.trim()}>
          {loadingText}&nbsp;
          <div className="typing-indicator inline">
            <div className="dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`typing-indicator ${className || ''}`.trim()}>
        <div className="dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }, [isCompressing]);

  useLayoutEffect(() => {
    if (messages.length === 0 || !isWithinLatestScrollStabilizationWindow()) return;
    scrollToLatestPosition('layout-effect');
  }, [chatSessionId, isWithinLatestScrollStabilizationWindow, messages.length, renderItemsWithActivity.length, scrollToLatestPosition]);

  return (
    <div className="chat-container-with-overlay">
      <div className="chat-container-reverse flex-1" ref={containerRef} onScroll={handleContainerScroll}>
        <div className="chat-message-flow-reverse" ref={messageFlowRef}>
          {/* Fixed boundary container */}
          {shouldShowBoundaryContainer() && (
            <div className={`message-boundary-container ${shouldShowTopLevelLoading() ? 'has-loading' : ''}`}>
              {shouldShowTopLevelLoading() && (
                <div className="message assistant-message loading-message fixed-boundary">
                  <div className="message-content">
                    <div className="flex w-full min-w-0 max-w-full items-start">
                      <div className="min-w-0 max-w-full flex-1">
                        {renderLoadingIndicator()}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {renderItemsWithActivity.reduceRight((acc, item, index) => {
            const rendered = (
              <ChatRenderItemComponent
                key={getChatRenderItemStableKey(item)}
                item={item}
                isLast={index === renderItemsWithActivity.length - 1}
                renderLoadingIndicator={renderLoadingIndicator}
                editingSourceMessageIndex={editingMessage?.index ?? -1}
                chatStatus={chatStatus}
                editingMessage={editingMessage}
                onSaveEditedMessage={editMessageActions.save}
                onCancelEdit={editMessageActions.cancel}
                onStartEdit={handleStartEdit}
                canEditUserMessage={canEditUserMessage}
                streamingMessageId={streamingMessageId}
                fileExistsCache={fileExistsCache}
              />
            );
            return (acc.push(rendered), acc);
          }, [] as React.ReactNode[])}

          <GreetingMessage />
        </div>
      </div>
      {showJumpToLatest && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="chat-jump-to-latest-button"
          onClick={handleJumpToLatestClick}
          aria-label="Scroll to latest message"
          title="Scroll to latest message"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3.5 4L8 8.5L12.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.5 8.5L8 13L12.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      )}
    </div>
  );
};

const ChatContainer: React.FC<ChatContainerProps> = memo(ChatContainerInner);
ChatContainer.displayName = 'ChatContainer';
export default ChatContainer;