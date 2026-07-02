import React, { useEffect, useState } from 'react';
import { useMatch, useParams } from 'react-router-dom';
import { useAgentById } from '@/states/agents.atom';
import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import SessionPanelHeader from './header/SessionPanelHeader';
import SessionsView from './sessions/SessionsView';
import JobsView from './jobs/JobsView';
import JobRunsView from './jobs/JobRunsView';
import { BACKDROP } from './backdrop';

/**
 * Left-pane orchestrator. Mode (sessions vs jobs) and selection are derived
 * **purely** from the URL — no atom holds this state. Switching agents drops
 * the `:jobId` segment naturally; refresh / back / forward / deep links all
 * just work because the URL is the truth.
 *
 * URL shape (see `entries/main.routes.tsx`):
 *   /agent                              → no agentId; nothing rendered below header
 *   /agent/:agentId                      → sessions, no selection
 *   /agent/:agentId/:sessionId           → sessions, selected
 *   /agent/:agentId/job                  → jobs list
 *   /agent/:agentId/job/:jobId           → runs list
 *   /agent/:agentId/job/:jobId/:sessionId → runs list, run selected (right pane shows the run)
 */
const SessionPanel: React.FC = () => {
  // The runs sub-tree exposes `:sessionId` at the same param name as `/agent/:agentId/:sessionId`,
  // so a single `useParams()` covers both modes.
  const { agentId: urlAgentId, jobId, sessionId } = useParams<{
    agentId?: string;
    jobId?: string;
    sessionId?: string;
  }>();
  const inJobsMode = useMatch('/agent/:agentId/job/*') !== null;

  // While the URL is `/agent` (no agentId), keep a stable last-active agentId from cache so the
  // header still shows the current agent's name; the body sub-screens require a real agentId.
  const [cachedAgentId, setCachedAgentId] = useState<string | null>(
    agentSessionCacheManager.getCurrentAgentId(),
  );
  useEffect(() => {
    return agentSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      setCachedAgentId(agentSessionCacheManager.getCurrentAgentId());
    });
  }, []);

  const displayAgentId = urlAgentId ?? cachedAgentId;
  const currentAgent = useAgentById(displayAgentId);

  return (
    <div
      data-dbg="session-panel"
      className="relative isolate flex flex-col h-full min-w-66 max-w-100 px-2"
    >
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-0 -z-10 h-100 w-full flex justify-center items-end">
        {BACKDROP}
      </div>
      <SessionPanelHeader
        agentId={displayAgentId}
        agent={currentAgent}
        mode={inJobsMode ? 'jobs' : 'sessions'}
        sessionId={sessionId ?? null}
      />
      {!displayAgentId && null}

      {displayAgentId && !inJobsMode && (
        <SessionsView
          agentId={displayAgentId}
          currentChatSessionId={sessionId ?? null}
        />
      )}

      {displayAgentId && inJobsMode && !jobId && (
        <JobsView agentId={displayAgentId} />
      )}

      {displayAgentId && inJobsMode && jobId && (
        <JobRunsView
          agentId={displayAgentId}
          jobId={jobId}
          activeSessionId={sessionId ?? null}
        />
      )}
    </div>
  );
};

export default SessionPanel;
