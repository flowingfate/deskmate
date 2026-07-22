import React from 'react';

import StatusBadges from '../ui/StatusBadges';
import ContextBadge from '../ui/ContextBadge';
import { useAgentById } from '@/states/agents.atom';
import { AgentAvatar } from '../common/AgentAvatar';
import { editAgent } from '@renderer/lib/chat/editAgent';


interface ChatViewHeaderProps {
  agentId: string;
  sessionId: string | null;
}

const ChatViewHeader: React.FC<ChatViewHeaderProps> = ({ agentId, sessionId }) => {
  const agent = useAgentById(agentId);

  return (
    <>
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => editAgent(agentId, 'basic')}
        >
          {agent && (
            <span className="inline-flex items-center">
              <AgentAvatar
                emoji={agent.emoji}
                avatar={agent.avatar}
                name={agent.name}
                size="md"
                version={agent.version}
              />
            </span>
          )}
          <span>{agent ? agent.name : 'Chat'}</span>
        </div>
        <StatusBadges agentId={agentId} />
      </div>
      <div className="flex shrink-0 items-center">
        <ContextBadge agentId={agentId} sessionId={sessionId} />
      </div>
    </>
  );
};



export default ChatViewHeader;