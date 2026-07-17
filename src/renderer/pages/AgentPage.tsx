import React, { memo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import AgentLayout from './layout/agent/AgentLayout';
import { getAgents, getPrimaryAgentId } from '@/states/agents.atom';
import { useMessagesWithStream, CurrentSessionStatus } from '@/lib/chat/agentSessionCacheManager';
import { newEntityId } from '@shared/persist/id';
import { log } from '@/log';

const logger = log.child({ mod: 'AgentPage' });

let hasAutoSelectedPrimaryAgentOnStartup = false;

const DevMonitor = memo(() => {
  const { messages, streamingMessageId } = useMessagesWithStream();
  const { chatStatus, chatSessionId } = CurrentSessionStatus.use();

  useEffect(() => {
    logger.debug({ msg: "📊 Cache Manager Data:", messagesCount: messages.length, chatSessionId, chatStatus, streamingMessageId, streamingMessageIdType: typeof streamingMessageId, isStreaming:
                      streamingMessageId !== null && streamingMessageId !== undefined, lastMessageId:
                      messages.length > 0
                        ? messages[messages.length - 1].id
                        : 'none' });
  }, [
    messages.length,
    chatSessionId,
    chatStatus,
    streamingMessageId,
  ]);

  return null;
});

export const AgentPage: React.FC = () => {
  const navigate = useNavigate();

  const selectPrimaryAgentOnStartup = useCallback(() => {
    logger.debug({ msg: "🚀 Selecting primary agent on startup..." });


    const agents = getAgents();
    logger.debug({ msg: "Selecting startup agent", agentsCount: agents.length });
    if (agents.length === 0) {
      logger.warn({ msg: "No agents found in profile" });
      return;
    }

    const primaryAgentId = getPrimaryAgentId();
    const targetAgentId = agents.find((agent) => agent.id === primaryAgentId)?.id ?? agents[0]?.id;
    if (!targetAgentId) {
      logger.warn({ msg: "No valid agentId found for primary agent selection" });
      return;
    }

    const chatSessionId = newEntityId('s');
    logger.debug({ msg: "Primary agent selected", agentId: targetAgentId, chatSessionId });
    navigate(`/agent/${targetAgentId}/${chatSessionId}`, { replace: true });
  }, [navigate]);

  const startupDoneRef = useRef(false);
  useEffect(() => {
    if (startupDoneRef.current || hasAutoSelectedPrimaryAgentOnStartup) return;

    hasAutoSelectedPrimaryAgentOnStartup = true;
    startupDoneRef.current = true;
    selectPrimaryAgentOnStartup();
  }, [selectPrimaryAgentOnStartup]);


  return (
    <>
      <AgentLayout />
      {process.env.NODE_ENV === 'development' && <DevMonitor />}
    </>
  );
};
