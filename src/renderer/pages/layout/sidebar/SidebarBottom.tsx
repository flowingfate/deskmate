import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PanelLeft, RotateCw, Settings } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { LeftNavCollapsedAtom } from '@/states/left-nav.atom';
import { useUpdate } from '@/components/autoUpdate/UpdateProvider';
import { SidebarUserAvatar } from './SidebarUserAvatar';

const SIDEBAR_ICON_SIZE = 14;

const SIDEBAR_ITEM =
  'relative flex items-center justify-center w-7 h-7 p-0 shrink-0 rounded-[7px] border-[1.5px] transition-[background-color,border-color] duration-150';
const SIDEBAR_ITEM_IDLE = 'border-transparent bg-transparent hover:bg-black/5';
const SIDEBAR_ITEM_ACTIVE = 'border-black/[0.12] bg-black/[0.07]';

export const SidebarBottom: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, installUpdate, isDialogOpen } = useUpdate();
  const [leftCollapsed, { toggle: toggleLeft }] = LeftNavCollapsedAtom.use();

  const isSettingsRoute = location.pathname.startsWith('/settings');
  const isAgentRoute = location.pathname.startsWith('/agent');

  return (
    <div className="flex shrink-0 flex-col items-center gap-1 py-1 border-t border-black/6">
      {status === 'downloaded' && !isDialogOpen && (
        <Button
          variant="ghost"
          size="icon"
          className={`${SIDEBAR_ITEM} ${SIDEBAR_ITEM_IDLE} text-accent hover:bg-accent-subtle hover:text-accent-hover animate-[sidebar-update-pulse_2s_ease-in-out_infinite]`}
          onClick={() => { installUpdate().catch(() => {}); }}
          title="Install Update Now"
          aria-label="Install Update Now"
        >
          <RotateCw size={SIDEBAR_ICON_SIZE} />
        </Button>
      )}

      {isAgentRoute && (
        <Button
          variant="ghost"
          size="icon"
          className={`${SIDEBAR_ITEM} ${leftCollapsed ? SIDEBAR_ITEM_ACTIVE : SIDEBAR_ITEM_IDLE}`}
          onClick={toggleLeft}
          aria-label={leftCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={leftCollapsed}
          title={leftCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
        >
          <PanelLeft size={SIDEBAR_ICON_SIZE} />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className={`${SIDEBAR_ITEM} ${isSettingsRoute ? SIDEBAR_ITEM_ACTIVE : SIDEBAR_ITEM_IDLE}`}
        onClick={() => navigate('/settings')}
        title="Settings"
      >
        <Settings size={SIDEBAR_ICON_SIZE} />
      </Button>

      <SidebarUserAvatar />
    </div>
  );
};
