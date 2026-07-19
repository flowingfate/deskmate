import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

import type { RenderMessage } from '@/lib/chat/renderMessage';
import { JumpToLatestAtom } from './ribbon/JumpToLatest';

const FOLLOW_LATEST_THRESHOLD_PX = 40;

interface ScrollOptions {
  force?: boolean;
}

interface UseChatAutoScrollArgs {
  sessionId: string;
  messages: RenderMessage[];
  streamingMessageId: string | undefined;
}

interface UseChatAutoScrollResult {
  containerRef: RefObject<HTMLDivElement>;
  messageFlowRef: RefObject<HTMLDivElement>;
  handleContainerScroll: () => void;
  isWithinLatestScrollStabilizationWindow: () => boolean;
  scrollToLatestPosition: (options?: ScrollOptions) => void;
}

export function useChatAutoScroll({
  sessionId,
  messages,
  streamingMessageId,
}: UseChatAutoScrollArgs): UseChatAutoScrollResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const messageFlowRef = useRef<HTMLDivElement>(null);
  const previousSessionIdRef = useRef<string | null | undefined>(undefined);
  const previousMessageCountRef = useRef<number | null>(null);
  const latestScrollFrameRef = useRef<number | null>(null);
  const trailingLatestScrollFrameRef = useRef<number | null>(null);
  const latestScrollTimeoutRef = useRef<number | null>(null);
  const latestScrollStabilizeUntilRef = useRef(0);
  const userScrolledAwayRef = useRef(false);
  const handledJumpRequestNonceRef = useRef<number | null>(null);
  const [{ requestNonce }, jumpToLatestActions] = JumpToLatestAtom.use();

  const latestMessageRole = messages[messages.length - 1]?.role;

  const handleContainerScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const distanceFromLatest =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAvailable = distanceFromLatest > FOLLOW_LATEST_THRESHOLD_PX;

    userScrolledAwayRef.current = isAvailable;
    jumpToLatestActions.setAvailable(isAvailable);
  }, [jumpToLatestActions]);

  const scrollToLatestPosition = useCallback((options?: ScrollOptions) => {
    const container = containerRef.current;
    if (!container || (!options?.force && userScrolledAwayRef.current)) return;

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

  const scheduleLatestScroll = useCallback((options?: ScrollOptions) => {
    if (options?.force) {
      userScrolledAwayRef.current = false;
      jumpToLatestActions.setAvailable(false);
    }

    openLatestScrollStabilizationWindow();
    clearPendingLatestScroll();
    scrollToLatestPosition(options);

    latestScrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollToLatestPosition(options);
      latestScrollFrameRef.current = null;

      trailingLatestScrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollToLatestPosition(options);
        trailingLatestScrollFrameRef.current = null;
      });
    });

    latestScrollTimeoutRef.current = window.setTimeout(() => {
      scrollToLatestPosition(options);
      latestScrollTimeoutRef.current = null;
    }, 180);
  }, [clearPendingLatestScroll, jumpToLatestActions, openLatestScrollStabilizationWindow, scrollToLatestPosition]);

  useEffect(() => {
    if (handledJumpRequestNonceRef.current === null) {
      handledJumpRequestNonceRef.current = requestNonce;
      return;
    }

    if (requestNonce === handledJumpRequestNonceRef.current) return;

    handledJumpRequestNonceRef.current = requestNonce;
    scheduleLatestScroll({ force: true });
  }, [requestNonce, scheduleLatestScroll]);

  useEffect(() => {
    return () => jumpToLatestActions.setAvailable(false);
  }, [jumpToLatestActions]);

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    const previousMessageCount = previousMessageCountRef.current;
    const nextSessionId = sessionId ?? null;
    const isFirstRender = previousMessageCount === null;
    const didSessionChange = nextSessionId !== previousSessionId;
    const didMessageCountIncrease = previousMessageCount !== null && messages.length > previousMessageCount;
    const shouldForceLatestScroll = isFirstRender || didSessionChange || latestMessageRole === 'user';

    if (messages.length > 0 && (isFirstRender || didSessionChange || didMessageCountIncrease)) {
      scheduleLatestScroll({ force: shouldForceLatestScroll });
    }

    previousSessionIdRef.current = nextSessionId;
    previousMessageCountRef.current = messages.length;
    return clearPendingLatestScroll;
  }, [sessionId, clearPendingLatestScroll, latestMessageRole, messages.length, scheduleLatestScroll]);

  const streamingMessageTextLength = useMemo(() => {
    if (!streamingMessageId) return 0;

    const message = messages.find((candidate) => candidate.id === streamingMessageId);
    if (!message || message.role !== 'assistant') return 0;

    return message.content.length + message.think.length;
  }, [messages, streamingMessageId]);

  useEffect(() => {
    if (!streamingMessageId || streamingMessageTextLength === 0) return;

    scheduleLatestScroll();
  }, [scheduleLatestScroll, streamingMessageId, streamingMessageTextLength]);

  useEffect(() => {
    const observedFlow = messageFlowRef.current;
    if (!observedFlow || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (isWithinLatestScrollStabilizationWindow()) {
        scrollToLatestPosition();
      }
    });

    observer.observe(observedFlow);
    return () => observer.disconnect();
  }, [isWithinLatestScrollStabilizationWindow, scrollToLatestPosition]);

  return {
    containerRef,
    messageFlowRef,
    handleContainerScroll,
    isWithinLatestScrollStabilizationWindow,
    scrollToLatestPosition,
  };
}
