import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import SettingsSidepanel from '@renderer/components/settings/sidepanel';
import { AgentContextType } from '@/types/agentContextTypes';
import ResizableDivider from '@/components/ui/ResizableDivider';
import {
  useSettingsMenus,
  useSettingsActions,
  SettingsFloatingMenus,
  SettingsDialogs,
} from './layout/settings';

const SettingsPage: React.FC = () => {
  const menus = useSettingsMenus();
  const actions = useSettingsActions();

  const settingsContext: AgentContextType = {
    onMcpServerConnect: actions.handleMcpServerConnect,
    onMcpServerDisconnect: actions.handleMcpServerDisconnect,
    onMcpServerReconnect: actions.handleMcpServerReconnect,
    onMcpServerDelete: actions.handleMcpServerDelete,
    onMcpServerEdit: actions.handleMcpServerEdit,
    onMcpServerMenuToggle: menus.handleMcpServerMenuToggle,
    mcpServerMenuState: menus.mcpServerMenu,
    onSkillMenuToggle: menus.handleSkillMenuToggle,
    onSubAgentsAddMenuToggle: menus.handleSubAgentsAddMenuToggle,
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        <SettingsSidepanel />
        <ResizableDivider />
        <div className="flex-1 flex flex-col min-w-0 mr-2 mb-2 overflow-hidden rounded-lg border border-black/7 shadow-[0px_2px_6px_rgba(0,0,0,0.05)]">
          <Outlet context={settingsContext} />
        </div>
      </div>

      <SettingsFloatingMenus
        menus={menus}
        onMcpServerConnect={actions.handleMcpServerConnect}
        onMcpServerDisconnect={actions.handleMcpServerDisconnect}
        onMcpServerReconnect={actions.handleMcpServerReconnect}
        onMcpServerDelete={actions.handleMcpServerDelete}
        onMcpServerEdit={actions.handleMcpServerEdit}
      />

      <SettingsDialogs
        deleteMcpDialog={actions.deleteMcpDialog}
        setDeleteMcpDialog={actions.setDeleteMcpDialog}
        handleConfirmDeleteMcp={actions.handleConfirmDeleteMcp}
      />
    </div>
  );
};

export default SettingsPage;
