import { useHasSessionCache, useSessionIsEmpty } from '../useSessionCache';

export type SessionActionTarget =
  | {
      kind: 'regular';
      agentId: string;
      sessionId: string;
    }
  | { kind: 'empty' }
  | { kind: 'job-run'; agentId: string; jobId: string; sessionId: string }
  | { kind: 'switching' };

interface UseSessionActionTargetArgs {
  agentId: string;
  jobId: string | null;
  sessionId: string | null;
  kind: 'regular' | 'job';
}

export function useSessionActionTarget({
  agentId,
  jobId,
  sessionId,
  kind,
}: UseSessionActionTargetArgs): SessionActionTarget {
  const hasSessionCache = useHasSessionCache(sessionId);
  const isEmpty = useSessionIsEmpty(sessionId);

  if (!sessionId) {
    return { kind: 'empty' };
  }

  if (!hasSessionCache) {
    return { kind: 'switching' };
  }

  if (kind === 'job') {
    if (!jobId) return { kind: 'switching' };
    return { kind: 'job-run', agentId, jobId, sessionId };
  }

  if (isEmpty) {
    return { kind: 'empty' };
  }

  return { kind: 'regular', agentId, sessionId };
}
