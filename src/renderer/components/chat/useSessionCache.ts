import { useRef, useSyncExternalStore } from 'react';
import {
  agentSessionCacheManager as cache,
  type ChatSessionCache,
} from '@/lib/chat/agentSessionCacheManager';


const NOOP = () => {};
const NOON_SUB = (update: VoidFunction) => NOOP;

type EQ<T> = (prev: T, next: T) => boolean;

function generate<T>(
  calc: (data: ChatSessionCache | null) => T,
  equal: EQ<T> = Object.is,
) {
  const zero = calc(null);
  const empty = { id: '_____', get: () => zero, sub: NOON_SUB };

  function create(id?: string | null) {
    if (!id) return empty;

    let prev = calc(cache.getChatSessionCache(id));
    const get = () => {
      const next = calc(cache.getChatSessionCache(id));
      if (equal(prev, next)) return prev;
      return prev = next;
    };
    const sub = (update: VoidFunction) => cache.subscribeToChatSessionCacheLifecycle((sid) => {
      if (id === sid) update();
    });

    return { id, get, sub };
  }

  return (sessionId?: string | null) => {
    const ref = useRef(empty);
    if (ref.current.id !== sessionId) {
      ref.current = create(sessionId);
    }
    const { get, sub } = ref.current;
    return useSyncExternalStore<T>(sub, get, get);
  };
}

export const useSessionCache = generate((cache) => cache);
export const useContextUsage = generate((cache) => cache?.contextTokenUsage);
export const useCumulativeUsage = generate((cache) => cache?.cumulativeTokenUsage);
export const useHasSessionCache = generate(Boolean);
export const useSessionError = generate((cache) => cache?.errorMessage);
export const useSessionIsEmpty = generate((c) => c ? c.messages.length === 0 : true);
