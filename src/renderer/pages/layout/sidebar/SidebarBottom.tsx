import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PanelLeft, RotateCw, Settings } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { LeftNavCollapsedAtom } from '@/states/left-nav.atom';
import { useUpdate } from '@/components/autoUpdate/UpdateProvider';
import { SidebarUserAvatar } from './SidebarUserAvatar';

const SIDEBAR_ICON_SIZE = 14;

export const SidebarBottom: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, installUpdate, isDialogOpen } = useUpdate();
  const [leftCollapsed, { toggle: toggleLeft }] = LeftNavCollapsedAtom.use();

  const isSettingsRoute = location.pathname.startsWith('/settings');
  const isAgentRoute = location.pathname.startsWith('/agent');

  return (
    <div className="app-sidebar-bottom">
      {status === 'downloaded' && !isDialogOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="sidebar-item sidebar-update-btn"
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
          className={`sidebar-item ${leftCollapsed ? 'active' : ''}`}
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
        className={`sidebar-item ${isSettingsRoute ? 'active' : ''}`}
        onClick={() => navigate('/settings')}
        title="Settings"
      >
        <Settings size={SIDEBAR_ICON_SIZE} />
      </Button>

      <SidebarUserAvatar />
    </div>
  );
};
