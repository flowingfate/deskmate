import React from 'react';

import StatusBadges from '../ui/StatusBadges';
import ContextBadge from '../ui/ContextBadge';
import { useCurrentAgent } from '@/states/agents.atom';
import { AgentAvatar } from '../common/AgentAvatar';


interface ChatViewHeaderProps {
  onOpenMcpTools?: () => void;
  onOpenTools?: () => void;
  onOpenSkills?: () => void;
}

const ChatViewHeader: React.FC<ChatViewHeaderProps> = ({
  onOpenMcpTools,
  onOpenSkills,
  onOpenTools,
}) => {
  // Get current agent configuration data - depends on currentAgentId to update on switch
  const agent = useCurrentAgent();

  return (
    <>
      <div className="flex items-center gap-2">
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
        <StatusBadges
          onOpenMcpTools={onOpenMcpTools}
          onOpenSkills={onOpenSkills}
          onOpenTools={onOpenTools}
        />
      </div>
      <div className="flex shrink-0 items-center">
        <ContextBadge />
      </div>
    </>
  );
};



export default ChatViewHeader;