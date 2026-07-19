import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MoreHorizontal, MessageSquare, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/shadcn/scroll-area';
import type { RegularSessionIndexEntry } from '@shared/persist/types';
import { ChatSessionMenuAtom } from '@/components/menu/ChatSessionDropdownMenu';
import { agentChatEvents } from '@/ipc/agentChat';
import { useAgentSessions, useAgentSessionsHydrated } from '@/states/sessionIndex.atom';
import { cn } from '@/lib/utilities/utils';


const SCROLL_THRESHOLD_PX = 80;

// ─── SessionItem ───

interface SessionItemProps {
  sessionId: string;
  title: string;
  readStatus?: string;
  isActive: boolean;
  starred?: boolean;
  isMenuOpen: boolean;
  isRunning: boolean;
  hasContextMenu: boolean;
  itemRef: (el: HTMLDivElement | null) => void;
  onClick: (e: React.MouseEvent) => void;
  onMenuToggle: (e: React.MouseEvent<HTMLElement>) => void;
}

const SessionItem: React.FC<SessionItemProps> = ({
  sessionId,
  title,
  readStatus,
  isActive,
  starred,
  isMenuOpen,
  isRunning,
  hasContextMenu,
  itemRef,
  onClick,
  onMenuToggle,
}) => {
  const isUnread = readStatus !== 'read' && !isActive;

  return (
    <div
      key={sessionId}
      ref={itemRef}
      data-dbg="session-list-item"
      className={cn(
        // `group/item` keeps the child hover/active styling local to this row,
        // so nested ScrollArea / SessionList groups don't trigger each other.
        'group/item relative flex items-center h-9 min-h-9 pl-2 pr-3 rounded-[4px] overflow-hidden',
        'cursor-pointer text-sm text-[#6C6C70] bg-transparent transition-colors',
        'hover:bg-black/[0.05]',
        isActive && 'bg-black/[0.05]',
      )}
      onClick={onClick}
      title={title}
    >
      <div
        className={cn(
          'flex items-center justify-center w-5 h-9 mr-1.5 shrink-0 text-black/25',
          'group-hover/item:text-black/35',
          isActive && 'text-black/35',
        )}
      >
        {isRunning ? <Loader2 size={16} className="animate-spin" /> : <MessageSquare size={14} />}
      </div>
      <span
        className={cn(
          'flex-1 min-w-0 truncate leading-5',
          // 410 is intentionally between Tailwind's 400 (normal) and 500 (medium)
          // — pulled from the legacy stylesheet for a slightly heavier feel.
          'font-[410]',
          isUnread && 'text-content font-semibold',
        )}
      >
        {title}
      </span>
      {hasContextMenu && (
        <div
          className={cn(
            'shrink-0 flex items-center cursor-pointer text-[#6C6C70]',
            'opacity-0 group-hover/item:opacity-100',
            isMenuOpen && 'opacity-100',
          )}
          data-chat-session-starred={starred ? 'true' : 'false'}
          onClick={onMenuToggle}
          title="More options"
        >
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
};

// ─── SessionList ───

interface SessionListProps {
  agentId: string;                       // 实为 agentId（route 沿用 agentId 命名）
  currentChatSessionId?: string | null;
  searchQuery?: string;
  onSelectChatSession?: (agentId: string, sessionId: string) => void;
  onDeleteChatSession?: (agentId: string, sessionId: string) => void;
  onForkChatSession?: (agentId: string, sessionId: string) => void;
}

// Shared classes for the empty-state / loading / "all loaded" hints inside the list.
const HINT_CLASS = 'flex items-center justify-center p-2 text-[#9E9E9E] text-[12px]';
// Section labels ("Starred" / "Conversations") above each group.
const SECTION_LABEL_CLASS =
  'pt-1 px-2 pb-[2px] text-[11px] font-bold text-[#6C6C70] uppercase tracking-[0.02em]';

export const SessionList: React.FC<SessionListProps> = ({
  agentId,
  currentChatSessionId,
  searchQuery = '',
  onSelectChatSession,
  onDeleteChatSession,
  onForkChatSession,
}) => {
  const [menuState, menuActions] = ChatSessionMenuAtom.use();
  const openMenuSessionId = menuState.isOpen ? menuState.sessionId : null;

  const sessions = useAgentSessions(agentId);
  const hydrated = useAgentSessionsHydrated(agentId);

  const [chatSessionStatuses, setChatSessionStatuses] = useState<Map<string, string>>(new Map());
  const [showAllLoaded, setShowAllLoaded] = useState(false);
  const exhaustedLatchRef = useRef(false);
  const allLoadedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // 跟踪上一次顶部 session id：变化时（= 新建/fork/重命名导致排序变）滚到顶。
  // 替代老路径里的 `chatSessionEvents.sessionCreated → scrollTop = 0`。
  const prevTopIdRef = useRef<string | null>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const triggerAllLoadedHint = useCallback(() => {
    if (showAllLoaded) return;
    setShowAllLoaded(true);
    clearTimeout(allLoadedTimerRef.current ?? undefined);
    allLoadedTimerRef.current = setTimeout(() => {
      setShowAllLoaded(false);
      allLoadedTimerRef.current = null;
    }, 800);
  }, [showAllLoaded]);

  useEffect(() => {
    const cleanup = agentChatEvents.streamingChunk((_event, chunk) => {
      if (chunk.type === 'status_changed' && chunk.chatSessionId && chunk.chatStatus) {
        setChatSessionStatuses(prev => {
          const next = new Map(prev);
          next.set(chunk.chatSessionId, chunk.chatStatus as string);
          return next;
        });
      }
    });
    return () => { if (cleanup) cleanup(); };
  }, []);

  useEffect(() => {
    if (!currentChatSessionId) return;
    let f1 = 0;
    let f2 = 0;
    f1 = window.requestAnimationFrame(() => {
      f2 = window.requestAnimationFrame(() => {
        const item = sessionItemRefs.current.get(currentChatSessionId);
        if (item) item.scrollIntoView({ block: 'nearest' });
      });
    });
    return () => { window.cancelAnimationFrame(f1); window.cancelAnimationFrame(f2); };
  }, [currentChatSessionId, sessions]);

  // 顶部 session id 变化时滚到顶（新建 / fork / 排序刷新场景）。
  // 跟原 `chatSessionEvents.sessionCreated` 触发的 scrollTop = 0 行为对齐；
  // 但若当前 active 就是新顶部，scrollIntoView 已覆盖，跳过避免双滚。
  useEffect(() => {
    const topId = sessions[0]?.id ?? null;
    const prev = prevTopIdRef.current;
    prevTopIdRef.current = topId;
    if (prev === null) return;                     // 首次 hydrate，不主动滚
    if (topId === null || topId === prev) return;
    if (topId === currentChatSessionId) return;    // 让 scrollIntoView 接管
    scrollViewportRef.current?.scrollTo({ top: 0 });
  }, [sessions, currentChatSessionId]);

  // 切 agent 时清掉 status 缓存与 prevTop 锚点，避免跨 agent 串台。
  useEffect(() => {
    setChatSessionStatuses(new Map());
    prevTopIdRef.current = null;
    exhaustedLatchRef.current = false;
  }, [agentId]);

  // 组件卸载时清掉 "All loaded" hint 的延时回调。
  useEffect(() => {
    return () => {
      clearTimeout(allLoadedTimerRef.current ?? undefined);
    };
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isNearBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD_PX;
    if (!isNearBottom) { exhaustedLatchRef.current = false; return; }
    // 新模型：sessionIndex 一次性 hydrate 全部月，没有"还能加载更多"的概念。
    // 滚到底时仅展示"All conversations loaded"提示。
    if (!exhaustedLatchRef.current) { exhaustedLatchRef.current = true; triggerAllLoadedHint(); }
  }, [triggerAllLoadedHint]);

  const handleSessionClick = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectChatSession?.(agentId, sessionId);
  }, [agentId, onSelectChatSession]);

  const handleMenuToggle = useCallback((sessionId: string, title: string, e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    menuActions.toggle(agentId, sessionId, title, e.currentTarget);
  }, [agentId, menuActions]);

  const hasContextMenu = !!(onDeleteChatSession || onForkChatSession);

  // Filtering
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  // 收藏区：直接从 sessionIndex（含 star 字段）派生，按 starredAt 倒序。
  const starredSessions = useMemo<RegularSessionIndexEntry[]>(() => {
    return sessions
      .filter(s => !!s.star)
      .sort((a, b) => {
        const ta = a.star?.starredAt ?? '';
        const tb = b.star?.starredAt ?? '';
        return ta < tb ? 1 : ta > tb ? -1 : 0;
      });
  }, [sessions]);

  const filteredSessions = useMemo<RegularSessionIndexEntry[]>(() => {
    if (!isSearching) return sessions;
    return sessions.filter(s => s.title?.toLowerCase().includes(normalizedQuery));
  }, [sessions, isSearching, normalizedQuery]);

  const filteredStarred = useMemo<RegularSessionIndexEntry[]>(() => {
    if (!isSearching) return starredSessions;
    return starredSessions.filter(s => s.title?.toLowerCase().includes(normalizedQuery));
  }, [starredSessions, isSearching, normalizedQuery]);

  return (
    <ScrollArea
      data-dbg="session-list"
      type="scroll"
      className="h-full"
      ref={(root) => {
        if (!root) { scrollViewportRef.current = null; return; }
        const viewport = root.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
        if (viewport && viewport !== scrollViewportRef.current) {
          scrollViewportRef.current = viewport;
        }
      }}
      onScrollCapture={handleScroll}
    >
      <div className="flex flex-col gap-[2px] py-1">
        {filteredStarred.length > 0 && (
          <>
            <div className={SECTION_LABEL_CLASS}>Starred</div>
            {filteredStarred.map(session => (
              <SessionItem
                key={session.id}
                sessionId={session.id}
                title={session.title}
                readStatus={session.readStatus}
                isActive={currentChatSessionId === session.id}
                starred
                isMenuOpen={openMenuSessionId === session.id}
                isRunning={!!(chatSessionStatuses.get(session.id) && chatSessionStatuses.get(session.id) !== 'idle')}
                hasContextMenu={hasContextMenu}
                itemRef={el => {
                  if (el) sessionItemRefs.current.set(session.id, el);
                  else sessionItemRefs.current.delete(session.id);
                }}
                onClick={e => handleSessionClick(session.id, e)}
                onMenuToggle={e => handleMenuToggle(session.id, session.title, e)}
              />
            ))}
            {filteredSessions.length > 0 && (
              <div className={SECTION_LABEL_CLASS}>Conversations</div>
            )}
          </>
        )}

        {filteredSessions.map(session => (
          <SessionItem
            key={session.id}
            sessionId={session.id}
            title={session.title}
            readStatus={session.readStatus}
            isActive={currentChatSessionId === session.id}
            starred={!!session.star}
            isMenuOpen={openMenuSessionId === session.id}
            isRunning={!!(chatSessionStatuses.get(session.id) && chatSessionStatuses.get(session.id) !== 'idle')}
            hasContextMenu={hasContextMenu}
            itemRef={el => {
              if (el) sessionItemRefs.current.set(session.id, el);
              else sessionItemRefs.current.delete(session.id);
            }}
            onClick={e => handleSessionClick(session.id, e)}
            onMenuToggle={e => handleMenuToggle(session.id, session.title, e)}
          />
        ))}

        {hydrated && filteredSessions.length === 0 && filteredStarred.length === 0 && (
          <div className={HINT_CLASS}>{isSearching ? 'No matching conversations' : 'No conversations yet'}</div>
        )}

        {!hydrated && (
          <div className={HINT_CLASS}>
            <Loader2 size={16} className="animate-spin" />
            <span className="ml-1.5">Loading...</span>
          </div>
        )}

        {showAllLoaded && (
          <div className={HINT_CLASS}>All conversations loaded</div>
        )}
      </div>
    </ScrollArea>
  );
};
