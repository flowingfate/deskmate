import React, { useRef, useEffect, useCallback, memo, useMemo, useState, useLayoutEffect, useReducer } from 'react';
import type { RenderMessage } from '@/lib/chat/renderMessage';
import { fsApi } from '@/ipc/fs';
import { type ChatStatus, getRenderItems } from '../../lib/chat/agentSessionCacheManager';
import { useToast } from '../ui/ToastProvider';
import { EditingMessageState, editMessageAtom } from './message/edit-message.atom';
import { getChatRenderItemStableKey, isVisibleChatRenderItem, ChatRenderItemComponent, type ChatRenderItem, hasTextContent } from './ChatRenderItem';
import { CHAT_SCROLL_BOX_CLS } from './tool/AnimatedHeight';
import { useChatAutoScroll } from './useChatAutoScroll';

interface ChatContainerProps {
  messages: RenderMessage[];
  streamingMessageId?: string; // ID of the message currently being streamed
  agentId?: string;
  chatSessionId?: string;
  chatStatus?: ChatStatus;
  editingMessage?: EditingMessageState | null;
  canEditUserMessage?: boolean;
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
    handleContainerScroll,
    isWithinLatestScrollStabilizationWindow,
    scrollToLatestPosition,
  } = useChatAutoScroll({ chatSessionId, messages, streamingMessageId });


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

  // 编辑中的用户消息在 renderItemsWithActivity 里的位置(render-items 坐标系);
  // 后续 dim 比对就在这个坐标系里做,不再回头去 messages 数组拿下标。
  const editingItemIndex = useMemo(() => {
    const editingId = editingMessage?.id;
    if (!editingId) return -1;
    return renderItemsWithActivity.findIndex(
      (it) => it.type === 'user' && it.message.id === editingId,
    );
  }, [editingMessage?.id, renderItemsWithActivity]);

  // 列表里最后一个 tool-section 的位置;chat 非 idle 时,只有它有可能还在被驱动。
  const lastSectionIndex = useMemo(() => {
    for (let i = renderItemsWithActivity.length - 1; i >= 0; i--) {
      if (renderItemsWithActivity[i].type === 'tool-calls-section') return i;
    }
    return -1;
  }, [renderItemsWithActivity]);

  const chatIsActive = chatStatus !== undefined && chatStatus !== 'idle';

  const isCompressing = chatStatus === 'compressing_context';
  const renderLoadingIndicator = useCallback((className?: string) => {
    let loadingText = '';
    if (isCompressing) {
      loadingText = 'Compressing...';
    }

    if (loadingText) {
      return (
        <div className={`flex items-center text-sm text-[#a3a3a3] font-medium min-h-5.5 ${className || ''}`.trim()}>
          {loadingText}&nbsp;
          <div className="inline-flex items-center ml-2">
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
      <div className={`flex items-center justify-start min-h-5.5 ${className || ''}`.trim()}>
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
    scrollToLatestPosition();
  }, [chatSessionId, isWithinLatestScrollStabilizationWindow, messages.length, renderItemsWithActivity.length, scrollToLatestPosition]);

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div className={`flex-1 ${CHAT_SCROLL_BOX_CLS} [--chat-pad-x:36px] overflow-y-auto [overflow-anchor:none] pt-6`} ref={containerRef} onScroll={handleContainerScroll}>
        <div className="chat-message-flow-reverse flex flex-col-reverse justify-start min-h-full" ref={messageFlowRef}>
          {/* Fixed boundary container */}
          {shouldShowBoundaryContainer() && (
            <div className={`message-boundary-container ${shouldShowTopLevelLoading() ? 'has-loading' : ''}`}>
              {shouldShowTopLevelLoading() && (
                <div className="animate-[fadeIn_0.3s_ease-out] min-w-0 max-w-full flex flex-col gap-2 assistant-message p-0 w-full loading-message fixed-boundary">
                  <div className="message-content relative min-w-0 max-w-full wrap-break-word flex flex-col text-[15px] leading-[1.7]">
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
            const shouldDim = editingItemIndex >= 0 && index > editingItemIndex;
            const isLive =
              item.type === 'tool-calls-section' && index === lastSectionIndex && chatIsActive;
            const rendered = (
              <ChatRenderItemComponent
                key={getChatRenderItemStableKey(item)}
                item={item}
                isLast={index === renderItemsWithActivity.length - 1}
                shouldDim={shouldDim}
                isLive={isLive}
                renderLoadingIndicator={renderLoadingIndicator}
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

        </div>
      </div>
    </div>
  );
};

const ChatContainer: React.FC<ChatContainerProps> = memo(ChatContainerInner);
ChatContainer.displayName = 'ChatContainer';
export default ChatContainer;