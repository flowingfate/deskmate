import React from 'react';
import { UserMenu } from './UserMenu';
import { Button } from '@/shadcn/button';
import { UserCircle } from 'lucide-react';

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
        <UserCircle size={14} />
      </Button>
    </UserMenu>
  );
};
