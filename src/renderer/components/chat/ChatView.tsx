import React, { useCallback, memo, useEffect } from 'react';
import {
  useParams,
  useNavigate,
  useLocation,
} from 'react-router-dom';

import ChatViewHeader from './ChatViewHeader';
import ChatViewContent from './ChatViewContent';
import { ContextMenu } from './chat-input/ContextMenu';
import { CurrentSessionStatus, useHasChatSessionCache, agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { currentSessionStore } from '@/states/currentSession.atom';
import { agentIpc } from '../../lib/chat/agentIpc';
import { startNewSessionFor } from '../../lib/chat/startNewSessionFor';
import { log } from '@/log';
import AgentPane from '@/pages/layout/agent/agent-pane';
import { editAgent as handleEditAgent } from '@/lib/chat/editAgent';
import { composeTextCommands } from './chat-input/chatInputCommands';

const logger = log.child({ mod: 'ChatView' });

/**
 * `kind` 决定 ChatView 如何拉取该 sessionId 的快照与已读状态：
 * - `'regular'`（默认）：URL `/agent/:agentId/:sessionId`，走 `ensureCache` + `markSessionRead`，
 *   IPC 命中 `regular_sessions` 表 + 物理目录 `agents/{a}/sessions/{ym}/{s}/`。
 * - `'job-run'`：URL `/agent/:agentId/job/:jobId/:sessionId`，走 `ensureJobRunCache` +
 *   `markJobRunRead`，IPC 命中 `job_runs` 表 + 物理目录 `agents/{a}/schedules/{j}/runs/{ym}/{s}/`。
 * 两条路径在主进程 IPC 层 / persist 层完全独立，**不混查**。
 */
export type ChatViewKind = 'regular' | 'job-run';

interface ChatViewProps {
  kind?: ChatViewKind;
}

const ChatView: React.FC<ChatViewProps> = memo(({ kind = 'regular' }) => {
  // 🔥 Route Synchronization
  const {
    agentId: routeAgentId,
    jobId: routeJobId,
    sessionId: routeSessionId,
  } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const navigationState = (location.state as {
    selectedText?: string;
    intent?: 'new-chat' | 'open-session';
    source?: string;
    targetAgentId?: string;
    targetSessionId?: string;
  } | null) ?? null;

  // Fill compose input from navigation state (selectedText)
  useEffect(() => {
    if (navigationState?.selectedText) {
      composeTextCommands.fillInput(navigationState.selectedText);
      // Clear state to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [navigationState, navigate, location.pathname]);

  // Get agentId and chatSessionId from agentSessionCacheManager
  const { agentId, chatSessionId, chatStatus } = CurrentSessionStatus.use();

  // Route is the source of truth for current chat/session. Drive the atom + cache from useParams.
  // No more switchToChatSession round-trip; main process is fully passive on "which session is active".
  useEffect(() => {
    // Case 1: Route has both IDs — adopt them as current. 按 `kind` 走对应的 IPC。
    if (routeAgentId && routeSessionId) {
      currentSessionStore.set({ agentId: routeAgentId, chatSessionId: routeSessionId });
      if (kind === 'job-run') {
        if (!routeJobId) {
          logger.warn({ msg: "kind=job-run without jobId in route", routeAgentId, routeSessionId });
          return;
        }
        void agentSessionCacheManager.ensureJobRunCache(routeAgentId, routeJobId, routeSessionId);
        void agentIpc.markJobRunRead(routeAgentId, routeJobId, routeSessionId);
      } else {
        void agentSessionCacheManager.ensureCache(routeAgentId, routeSessionId);
        void agentIpc.markSessionRead(routeAgentId, routeSessionId);
      }
      return;
    }

    // Case 2: Route has only agentId with explicit new-chat intent — create a session and redirect.
    // 仅 regular 形态；job-run 永远从已存在的 run 进入（URL 必带 sessionId）。
    if (routeAgentId && !routeSessionId) {
      if (kind === 'job-run') {
        return;
      }
      const routeIntent = navigationState?.intent;
      if (routeIntent !== 'new-chat') {
        logger.debug({ msg: "Route has agentId only without new-chat intent, skipping auto-create" });
        return;
      }
      (async () => {
        const result = await startNewSessionFor(routeAgentId);
        if (result.success && result.chatSessionId) {
          navigate(`/agent/${routeAgentId}/${result.chatSessionId}`, {
            replace: true,
            state: {
              ...navigationState,
              intent: 'open-session',
              targetAgentId: routeAgentId,
              targetSessionId: result.chatSessionId,
            },
          });
        }
      })();
      return;
    }

    // Case 3: No IDs in route — clear current
    currentSessionStore.set({ agentId: null, chatSessionId: null });
  }, [routeAgentId, routeJobId, routeSessionId, kind, navigate, navigationState]);

  const hasRouteSessionCache = useHasChatSessionCache(routeSessionId ?? null);

  const isSessionSwitching = Boolean(
    routeSessionId && (chatSessionId !== routeSessionId || !hasRouteSessionCache)
  );

  // MCP Tools handler - must be defined after agentId
  const handleOpenMcpTools = useCallback(() => {
    if (agentId) {
      handleEditAgent(agentId, 'mcp');
    }
  }, [agentId, handleEditAgent]);

  // Skills handler - open editor and navigate to Skills tab
  const handleOpenSkills = useCallback(() => {
    if (agentId) {
      handleEditAgent(agentId, 'skills');
    }
  }, [agentId, handleEditAgent]);


  return (
    <>
      <AgentPane className="h-full">
        <AgentPane.Head>
          <ChatViewHeader
            onOpenMcpTools={handleOpenMcpTools}
            onOpenSkills={handleOpenSkills}
            currentChatSessionId={chatSessionId}
          />
        </AgentPane.Head>
        <AgentPane.Body>
          <ChatViewContent
            isSessionSwitching={isSessionSwitching}
            agentId={agentId}
            chatStatus={chatStatus}
            isReadOnly={false}
          />
        </AgentPane.Body>
      </AgentPane>
      <ContextMenu />
    </>
  );
});

ChatView.displayName = 'ChatView';

export default ChatView;
