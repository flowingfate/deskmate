import React from 'react';
import {
  McpServerDropdownMenu,
  SkillsAddMenuDropdown,
  SkillDropdownMenu,
  SubAgentsAddMenuDropdown,
} from '@/components/menu';
import type { SettingsMenus } from './useSettingsMenus';

interface SettingsFloatingMenusProps {
  menus: SettingsMenus;
  onMcpServerConnect: (serverName: string) => Promise<void>;
  onMcpServerDisconnect: (serverName: string) => Promise<void>;
  onMcpServerReconnect: (serverName: string) => Promise<void>;
  onMcpServerDelete: (serverName: string) => void;
  onMcpServerEdit: (serverName: string) => void;
}

const SettingsFloatingMenus: React.FC<SettingsFloatingMenusProps> = ({
  menus,
  onMcpServerConnect,
  onMcpServerDisconnect,
  onMcpServerReconnect,
  onMcpServerDelete,
  onMcpServerEdit,
}) => {
  return (
    <>
      {menus.mcpServerMenu.isOpen && menus.mcpServerMenu.anchorElement && menus.mcpServerMenu.serverName && (
        <McpServerDropdownMenu
          serverName={menus.mcpServerMenu.serverName}
          anchorElement={menus.mcpServerMenu.anchorElement}
          onConnect={onMcpServerConnect}
          onDisconnect={onMcpServerDisconnect}
          onReconnect={onMcpServerReconnect}
          onDelete={onMcpServerDelete}
          onEdit={onMcpServerEdit}
          onClose={menus.handleMcpServerMenuClose}
        />
      )}

      {menus.skillsAddMenu.isOpen && menus.skillsAddMenu.anchorElement && (
        <SkillsAddMenuDropdown
          anchorElement={menus.skillsAddMenu.anchorElement}
          onClose={menus.handleSkillsAddMenuClose}
        />
      )}

      {menus.skillMenu.isOpen && menus.skillMenu.anchorElement && menus.skillMenu.skillName && (
        <SkillDropdownMenu
          skillName={menus.skillMenu.skillName}
          anchorElement={menus.skillMenu.anchorElement}
          onClose={menus.handleSkillMenuClose}
        />
      )}

      {menus.subAgentsAddMenu.isOpen && menus.subAgentsAddMenu.anchorElement && (
        <SubAgentsAddMenuDropdown
          anchorElement={menus.subAgentsAddMenu.anchorElement}
          onClose={menus.handleSubAgentsAddMenuClose}
        />
      )}
    </>
  );
};

export default SettingsFloatingMenus;
