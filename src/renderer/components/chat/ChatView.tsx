import React, { memo, useEffect } from 'react';
import { useParams } from 'react-router-dom';

import ChatViewHeader from './ChatViewHeader';
import ChatViewContent from './ChatViewContent';
import { ContextMenu } from './chat-input/ContextMenu';
import { agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { useHasSessionCache } from './useSessionCache';
import { CurrentSession } from '@/states/currentSession.atom';
import { agentIpc } from '../../lib/chat/agentIpc';
import { log } from '@/log';
import AgentPane from '@/pages/layout/agent/agent-pane';

const logger = log.child({ mod: 'ChatView' });

/**
 * `kind` 决定 ChatView 如何拉取该 sessionId 的快照与已读状态：
 * - `'regular'`（默认）：URL `/agent/:agentId/:sessionId`，走 `ensureCache` + `markSessionRead`，
 *   IPC 命中 `regular_sessions` 表 + 物理目录 `agents/{a}/sessions/{ym}/{s}/`。
 * - `'job-run'`：URL `/agent/:agentId/job/:jobId/:sessionId`，走 `ensureJobRunCache` +
 *   `markJobRunRead`，IPC 命中 `job_runs` 表 + 物理目录 `agents/{a}/schedules/{j}/runs/{ym}/{s}/`。
 * 两条路径在主进程 IPC 层 / persist 层完全独立，**不混查**。
 */
export type ChatViewKind = 'regular' | 'job';

interface ChatViewProps {
  kind?: ChatViewKind;
}

function ChatRoutePlaceholder(): React.JSX.Element {
  return (
    <AgentPane className="h-full">
      <AgentPane.Head>None Agent</AgentPane.Head>
      <AgentPane.Body>
        <div className="flex h-full items-center justify-center text-sm text-sc-muted-foreground">
          Choose a agent to begin.
        </div>
      </AgentPane.Body>
    </AgentPane>
  );
}

const ChatView: React.FC<ChatViewProps> = memo(({ kind = 'regular' }) => {
  const { agentId, jobId, sessionId } = useParams();
  const hasSessionCache = useHasSessionCache(sessionId);

  // Route is the source of truth for the active chat/session. Drive the atom + cache from useParams.
  // No main-process round-trip is needed to select a session.
  useEffect(() => {
    if (!agentId) {
      CurrentSession.set({ agentId: null, jobId: null, sessionId: null });
    } else {
      CurrentSession.set({ agentId, jobId: jobId ?? null, sessionId: sessionId ?? null });
      if (!sessionId) return;
      if (kind === 'job') {
        if (!jobId) {
          logger.warn({ msg: 'kind=job without jobId in route', agentId, sessionId });
          return;
        }
        agentSessionCacheManager.ensureJobRunCache(agentId, jobId, sessionId);
        agentIpc.markJobRunRead(agentId, jobId, sessionId);
      } else {
        agentSessionCacheManager.ensureCache(agentId, sessionId);
        agentIpc.markSessionRead(agentId, sessionId);
      }
    }
  }, [agentId, jobId, sessionId, kind]);

  if (!agentId) {
    return <ChatRoutePlaceholder />;
  }

  const isSessionSwitching = Boolean(sessionId && !hasSessionCache);

  return (
    <>
      <AgentPane className="h-full">
        <AgentPane.Head>
          <ChatViewHeader agentId={agentId} sessionId={sessionId ?? null} />
        </AgentPane.Head>
        <AgentPane.Body>
          <ChatViewContent
            agentId={agentId}
            jobId={jobId ?? null}
            sessionId={sessionId ?? null}
            isSessionSwitching={isSessionSwitching}
            kind={kind}
          />
        </AgentPane.Body>
      </AgentPane>
      <ContextMenu />
    </>
  );
});

ChatView.displayName = 'ChatView';

export default ChatView;
