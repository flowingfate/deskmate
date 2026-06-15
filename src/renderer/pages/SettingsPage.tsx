import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
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
  const navigate = useNavigate();
  const location = useLocation();

  const menus = useSettingsMenus();
  const actions = useSettingsActions();

  // Record path before entering settings page
  useEffect(() => {
    const currentPath = location.pathname;
    if (currentPath.startsWith('/settings')) {
      const storedPreviousPath = sessionStorage.getItem('previousPath');
      if (!storedPreviousPath) {
        sessionStorage.setItem('settingsReturnPath', '/agent');
      } else {
        sessionStorage.setItem('settingsReturnPath', storedPreviousPath);
      }
    }
  }, [location.pathname]);

  const handleBack = () => {
    const returnPath = location.state?.returnPath || sessionStorage.getItem('settingsReturnPath');
    if (returnPath && returnPath !== '/settings') {
      sessionStorage.removeItem('settingsReturnPath');
      navigate(returnPath);
    } else {
      navigate('/agent');
    }
  };

  const settingsContext: AgentContextType = {
    onMcpServerConnect: actions.handleMcpServerConnect,
    onMcpServerDisconnect: actions.handleMcpServerDisconnect,
    onMcpServerReconnect: actions.handleMcpServerReconnect,
    onMcpServerDelete: actions.handleMcpServerDelete,
    onMcpServerEdit: actions.handleMcpServerEdit,
    onMcpServerMenuToggle: menus.handleMcpServerMenuToggle,
    mcpServerMenuState: menus.mcpServerMenu,
    onMcpAddMenuToggle: menus.handleMcpAddMenuToggle,
    onSkillsAddMenuToggle: menus.handleSkillsAddMenuToggle,
    onSkillMenuToggle: menus.handleSkillMenuToggle,
    onSubAgentsAddMenuToggle: menus.handleSubAgentsAddMenuToggle,
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        <SettingsSidepanel onBack={handleBack} />
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
        deleteSkillDialog={actions.deleteSkillDialog}
        setDeleteSkillDialog={actions.setDeleteSkillDialog}
        handleConfirmDeleteSkill={actions.handleConfirmDeleteSkill}
        deleteMcpDialog={actions.deleteMcpDialog}
        setDeleteMcpDialog={actions.setDeleteMcpDialog}
        handleConfirmDeleteMcp={actions.handleConfirmDeleteMcp}
        deleteSubAgentDialog={actions.deleteSubAgentDialog}
        setDeleteSubAgentDialog={actions.setDeleteSubAgentDialog}
        handleConfirmDeleteSubAgent={actions.handleConfirmDeleteSubAgent}
        applySubAgentDialogState={actions.applySubAgentDialogState}
        setApplySubAgentDialogState={actions.setApplySubAgentDialogState}
      />
    </div>
  );
};

export default SettingsPage;
