import React from 'react';
import { UserMenu } from './UserMenu';
import { Button } from '@/shadcn/button';

export const SidebarUserAvatar: React.FC = () => {
  const displayName = 'Guest';

  return (
    <UserMenu>
      <Button
        variant="ghost"
        size="icon"
        className="sidebar-item"
        title={displayName}
        aria-label="User menu"
      >
        <span className="text-base">👤</span>
      </Button>
    </UserMenu>
  );
};
