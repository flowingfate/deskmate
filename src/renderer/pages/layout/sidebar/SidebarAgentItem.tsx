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
      className={`sidebar-item ${isActive ? 'active' : ''}`}
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
      {hasUnread && <span className="sidebar-unread-dot" />}
    </Button>
  );
};
