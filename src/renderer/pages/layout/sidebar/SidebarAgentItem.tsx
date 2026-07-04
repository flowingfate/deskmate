import React from 'react';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { Button } from '@/shadcn/button';
import type { AgentRecord } from '@shared/persist/types';
import type { AgentUnreadSummary } from '@shared/types/chatSessionTypes';

interface SidebarAgentItemProps {
  agent: AgentRecord;
  isActive: boolean;
  unreadSummary?: AgentUnreadSummary;
  onClick: () => void;
}

export const SidebarAgentItem: React.FC<SidebarAgentItemProps> = ({ agent, isActive, unreadSummary, onClick }) => {
  const hasUnread = unreadSummary
    ? (unreadSummary.userUnreadCount + unreadSummary.scheduledUnreadCount) > 0
    : false;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`relative flex items-center justify-center w-7 h-7 p-0 shrink-0 rounded-[7px] border-[1.5px] transition-[background-color,border-color] duration-150 ${isActive ? 'border-black/[0.12] bg-black/[0.07]' : 'border-transparent bg-transparent hover:bg-black/5'}`}
      onClick={onClick}
      title={agent.name || 'Agent'}
    >
      <AgentAvatar
        emoji={agent.emoji}
        avatar={agent.avatar}
        name={agent.name}
        size="sm"
        version={agent.version}
      />
      {hasUnread && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#e92b0e] pointer-events-none" />}
    </Button>
  );
};
