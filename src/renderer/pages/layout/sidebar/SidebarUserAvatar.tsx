import React from 'react';
import { UserMenu } from './UserMenu';
import { Button } from '@/shadcn/button';
import { UserCircle } from 'lucide-react';

export const SidebarUserAvatar: React.FC = () => {
  return (
    <UserMenu>
      {(currentProfile) => {
        const displayName = currentProfile?.displayName ?? 'Profiles';
        return (
          <Button
            variant="ghost"
            size="icon"
            className="relative flex items-center justify-center w-7 h-7 p-0 shrink-0 rounded-[7px] border-[1.5px] border-transparent bg-transparent transition-[background-color,border-color] duration-150 hover:bg-black/5"
            title={`Profiles: ${displayName}`}
            aria-label={`Open profiles menu for ${displayName}`}
          >
            <UserCircle size={14} />
          </Button>
        );
      }}
    </UserMenu>
  );
};
