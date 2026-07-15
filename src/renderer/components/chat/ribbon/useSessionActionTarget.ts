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
  | { kind: 'job-run'; agentId: string; jobId: string; sessionId: string }
  | { kind: 'switching' };

export function useSessionActionTarget(): SessionActionTarget {
  const { agentId: routeAgentId, sessionId: routeSessionId } = useParams();
  const jobRunRoute = useMatch('/agent/:agentId/job/:jobId/:sessionId');
  const { agentId: currentAgentId, chatSessionId } = CurrentSessionStatus.use();
  const hasRouteSessionCache = useHasChatSessionCache(routeSessionId ?? null);
  const { messages } = useMessagesWithStream();

  if (!routeAgentId || !routeSessionId) {
    return { kind: 'empty' };
  }


  if (
    currentAgentId !== routeAgentId
    || chatSessionId !== routeSessionId
    || !hasRouteSessionCache
  ) {
    return { kind: 'switching' };
  }

  if (jobRunRoute) {
    const routeJobId = jobRunRoute.params.jobId;
    if (!routeJobId) return { kind: 'switching' };
    return {
      kind: 'job-run',
      agentId: routeAgentId,
      jobId: routeJobId,
      sessionId: routeSessionId,
    };
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
