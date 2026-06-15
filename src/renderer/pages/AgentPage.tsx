import React, { memo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import AgentLayout from './layout/agent/AgentLayout';
import { getAgents, getPrimaryAgentName } from '@/states/agents.atom';
import { getProfileId } from '@/states/profile.atom';
import {
  useMessagesWithStream,
  CurrentSessionStatus,
  useCurrentChatSessionId,
  useCurrentAgentId,
} from '@/lib/chat/agentSessionCacheManager';
import { startNewSessionFor } from '@/lib/chat/startNewSessionFor';
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

  const currentChatSessionId = useCurrentChatSessionId();
  const currentAgentId = useCurrentAgentId();

  const selectPrimaryAgentOnStartup = useCallback(async () => {
    logger.debug({ msg: "🚀 Selecting primary agent on startup..." });

    try {
      const profileId = getProfileId();
      if (!profileId) {
        logger.warn({ msg: "No profile found, skipping primary agent selection" });
        return;
      }

      const primaryAgentName = getPrimaryAgentName();
      const agents = getAgents();
      logger.debug({ msg: "Primary agent name", primaryAgentName, agentsCount: agents.length });

      if (agents.length === 0) {
        logger.warn({ msg: "No agents found in profile" });
        return;
      }

      const primaryAgent = agents.find((a) => a.name === primaryAgentName);

      let targetAgentId: string | undefined;

      if (primaryAgent?.id) {
        targetAgentId = primaryAgent.id;
        logger.debug({ msg: "Found primary agent agentId:", data: targetAgentId });
      } else {
        const firstAgent = agents[0];
        if (firstAgent?.id) {
          targetAgentId = firstAgent.id;
          logger.debug({ msg: "Primary agent not found, falling back to first agent:", data: targetAgentId });
        }
      }

      if (!targetAgentId) {
        logger.warn({ msg: "No valid agentId found for primary agent selection" });
        return;
      }

      const result = await startNewSessionFor(targetAgentId);
      if (result.success && result.chatSessionId) {
        logger.debug({ msg: "✅ Primary agent selected successfully:", agentId: targetAgentId, chatSessionId: result.chatSessionId });
        navigate(`/agent/${targetAgentId}/${result.chatSessionId}`, { replace: true });
      } else {
        logger.warn({ msg: "Failed to start new chat for primary agent:", data: result.error });
      }
    } catch (error) {
      logger.error({ msg: "Error selecting primary agent on startup:", err: error });
    }
  }, [navigate]);

  const startupDoneRef = useRef(false);
  useEffect(() => {
    if (startupDoneRef.current) return;

    const profileId = getProfileId();
    if (!profileId) return;

    if (!hasAutoSelectedPrimaryAgentOnStartup) {
      hasAutoSelectedPrimaryAgentOnStartup = true;
      startupDoneRef.current = true;
      logger.debug({ msg: "🚀 Startup: selecting primary agent..." });
      void selectPrimaryAgentOnStartup();
    }
  }, [selectPrimaryAgentOnStartup]);

  const syncWithAgentChatManager = useCallback(async () => {
    if (!currentAgentId) return;

    logger.debug({ msg: "📊 Sync check:", currentAgentId, currentChatSessionId });

    if (currentChatSessionId) {
      return;
    }

    logger.debug({ msg: "🚀 No chatSessionId, calling startNewSessionFor to initialize" });

    const result = await startNewSessionFor(currentAgentId);

    if (result.success && result.chatSessionId) {
      logger.debug({ msg: "📝 Auto-initialized chatSessionId:", data: result.chatSessionId });
    } else {
      logger.error({ msg: "❌ Failed to auto-initialize chatSessionId" });
    }
    return;
  }, [currentAgentId, currentChatSessionId]);

  useEffect(() => {
    syncWithAgentChatManager();
  }, [currentAgentId, currentChatSessionId, syncWithAgentChatManager]);

  return (
    <>
      <AgentLayout />
      {process.env.NODE_ENV === 'development' && <DevMonitor />}
    </>
  );
};
