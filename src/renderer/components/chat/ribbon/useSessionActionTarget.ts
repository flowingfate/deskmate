import { useMatch, useParams } from 'react-router-dom';
import {
  CurrentSessionStatus,
  useHasChatSessionCache,
  useMessagesWithStream,
} from '@/lib/chat/agentSessionCacheManager';

export type SessionActionTarget =
  | {
      kind: 'regular';
      agentId: string;
      sessionId: string;
    }
  | { kind: 'empty' }
  | { kind: 'job-run' }
  | { kind: 'switching' };

export function useSessionActionTarget(): SessionActionTarget {
  const { agentId: routeAgentId, sessionId: routeSessionId } = useParams();
  const isJobRunRoute = useMatch('/agent/:agentId/job/:jobId/:sessionId') !== null;
  const { agentId: currentAgentId, chatSessionId } = CurrentSessionStatus.use();
  const hasRouteSessionCache = useHasChatSessionCache(routeSessionId ?? null);
  const { messages } = useMessagesWithStream();

  if (!routeAgentId || !routeSessionId) {
    return { kind: 'empty' };
  }

  if (isJobRunRoute) {
    return { kind: 'job-run' };
  }

  if (
    currentAgentId !== routeAgentId
    || chatSessionId !== routeSessionId
    || !hasRouteSessionCache
  ) {
    return { kind: 'switching' };
  }

  if (messages.length === 0) {
    return { kind: 'empty' };
  }

  return {
    kind: 'regular',
    agentId: routeAgentId,
    sessionId: routeSessionId,
  };
}
