// 渲染端"当前活跃 session"的 source of truth。
// 由顶层路由（ChatView）依据 useParams 写入，其他组件读。
// 主进程不再 echo current；本 store 与主进程完全解耦。

import { useSyncExternalStore } from 'react';

export type CurrentSession = {
  agentId: null;
  jobId: null;
  chatSessionId: null;
} | {
  agentId: string;
  jobId: string | null;
  chatSessionId: string | null;
}

const EMPTY: CurrentSession = { agentId: null, jobId: null, chatSessionId: null };

let state: CurrentSession = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export const currentSessionStore = {
  get(): CurrentSession {
    return state;
  },
  set(next: CurrentSession): void {
    if (state.agentId === next.agentId && state.jobId === next.jobId && state.chatSessionId === next.chatSessionId) return;
    state = next;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

const subscribe = currentSessionStore.subscribe;
const getSnapshot = currentSessionStore.get;

export function useCurrentSession(): CurrentSession {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
