import { useSyncExternalStore } from 'react';
import { mainToRender, renderToMain } from '@shared/ipc/subagentRun';
import type { SubrunId } from '@shared/persist/types';
import type { SubAgentRuntimeState } from '@shared/types/subAgentRunTypes';

export const subagentRunApi = renderToMain.bindRender(window.electronAPI.subagentRun.invoke);

const subagentRunEvents = mainToRender.bindRender(
  window.electronAPI.subagentRun.on,
  window.electronAPI.subagentRun.off,
);

const statesByCorrelationId = new Map<string, SubAgentRuntimeState>();
const listeners = new Set<() => void>();

subagentRunEvents.stateUpdate((_event, state) => {
  if (!state.correlationId) return;
  if (state.status === 'pending' || state.status === 'running') {
    statesByCorrelationId.set(state.correlationId, state);
  } else {
    statesByCorrelationId.delete(state.correlationId);
  }
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSubagentRunState(
  correlationId: string,
  profileId: string | null,
  parentAgentId: string | null,
  parentSessionId: string | null,
  subrunId: SubrunId | undefined,
): SubAgentRuntimeState | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const state = statesByCorrelationId.get(correlationId);
      if (!state) return null;
      return state.profileId === profileId
        && state.parentAgentId === parentAgentId
        && state.parentSessionId === parentSessionId
        && (subrunId === undefined || state.subrunId === subrunId)
        ? state
        : null;
    },
    () => null,
  );
}
