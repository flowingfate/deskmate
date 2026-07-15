import React, { memo, useEffect } from 'react';
import { useParams } from 'react-router-dom';

import ChatViewHeader from './ChatViewHeader';
import ChatViewContent from './ChatViewContent';
import { ContextMenu } from './chat-input/ContextMenu';
import { CurrentSessionStatus, useHasChatSessionCache, agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { currentSessionStore } from '@/states/currentSession.atom';
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

const ChatView: React.FC<ChatViewProps> = memo(({ kind = 'regular' }) => {
  // 🔥 Route Synchronization
  const { agentId: rAgentId, jobId: rJobId, sessionId: rSessionId } = useParams();
  const { agentId, chatSessionId, chatStatus } = CurrentSessionStatus.use();

  // Route is the source of truth for the active chat/session. Drive the atom + cache from useParams.
  // No main-process round-trip is needed to select a session.
  useEffect(() => {
    if (!rAgentId) {
      currentSessionStore.set({ agentId: null, jobId: null, chatSessionId: null });
    } else {
      currentSessionStore.set({ agentId: rAgentId, jobId: rJobId ?? null, chatSessionId: rSessionId ?? null });
      if (!rSessionId) return;
      if (kind === 'job') {
        if (!rJobId) {
          logger.warn({ msg: "kind=job without jobId in route", routeAgentId: rAgentId, routeSessionId: rSessionId });
          return;
        }
        agentSessionCacheManager.ensureJobRunCache(rAgentId, rJobId, rSessionId);
        agentIpc.markJobRunRead(rAgentId, rJobId, rSessionId);
      } else {
        agentSessionCacheManager.ensureCache(rAgentId, rSessionId);
        agentIpc.markSessionRead(rAgentId, rSessionId);
      }
    }
  }, [rAgentId, rJobId, rSessionId, kind]);

  const hasRouteSessionCache = useHasChatSessionCache(rSessionId ?? null);
  const isSessionSwitching = Boolean(rSessionId && (chatSessionId !== rSessionId || !hasRouteSessionCache));

  return (
    <>
      <AgentPane className="h-full">
        <AgentPane.Head>
          <ChatViewHeader />
        </AgentPane.Head>
        <AgentPane.Body>
          <ChatViewContent
            isSessionSwitching={isSessionSwitching}
            agentId={agentId}
            chatStatus={chatStatus}
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
