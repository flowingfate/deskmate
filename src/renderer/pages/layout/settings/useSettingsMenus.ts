import { useState } from 'react';

interface MenuState<T extends string = string> {
  isOpen: boolean;
  anchorElement: HTMLElement | null;
  name?: T | null;
}

interface NamedMenuState {
  isOpen: boolean;
  serverName: string | null;
  anchorElement: HTMLElement | null;
}

interface SkillMenuState {
  isOpen: boolean;
  skillName: string | null;
  anchorElement: HTMLElement | null;
}

interface SimpleMenuState {
  isOpen: boolean;
  anchorElement: HTMLElement | null;
}

export interface SettingsMenus {
  mcpServerMenu: NamedMenuState;
  skillsAddMenu: SimpleMenuState;
  skillMenu: SkillMenuState;
  subAgentsAddMenu: SimpleMenuState;

  handleMcpServerMenuToggle: (serverName: string, buttonElement: HTMLElement) => void;
  handleMcpServerMenuClose: () => void;
  handleSkillsAddMenuToggle: (buttonElement: HTMLElement) => void;
  handleSkillsAddMenuClose: () => void;
  handleSkillMenuToggle: (skillName: string, buttonElement: HTMLElement) => void;
  handleSkillMenuClose: () => void;
  handleSubAgentsAddMenuToggle: (buttonElement: HTMLElement) => void;
  handleSubAgentsAddMenuClose: () => void;
}

export function useSettingsMenus(): SettingsMenus {
  const [mcpServerMenu, setMcpServerMenu] = useState<NamedMenuState>({
    isOpen: false,
    serverName: null,
    anchorElement: null,
  });

  const [skillsAddMenu, setSkillsAddMenu] = useState<SimpleMenuState>({
    isOpen: false,
    anchorElement: null,
  });

  const [skillMenu, setSkillMenu] = useState<SkillMenuState>({
    isOpen: false,
    skillName: null,
    anchorElement: null,
  });

  const [subAgentsAddMenu, setSubAgentsAddMenu] = useState<SimpleMenuState>({
    isOpen: false,
    anchorElement: null,
  });

  const handleMcpServerMenuToggle = (serverName: string, buttonElement: HTMLElement) => {
    if (mcpServerMenu.isOpen && mcpServerMenu.serverName === serverName) {
      setMcpServerMenu({ isOpen: false, serverName: null, anchorElement: null });
    } else {
      setMcpServerMenu({ isOpen: true, serverName, anchorElement: buttonElement });
    }
  };

  const handleMcpServerMenuClose = () => {
    setMcpServerMenu({ isOpen: false, serverName: null, anchorElement: null });
  };

  const handleSkillsAddMenuToggle = (buttonElement: HTMLElement) => {
    setSkillsAddMenu((prev) =>
      prev.isOpen ? { isOpen: false, anchorElement: null } : { isOpen: true, anchorElement: buttonElement },
    );
  };

  const handleSkillsAddMenuClose = () => {
    setSkillsAddMenu({ isOpen: false, anchorElement: null });
  };

  const handleSkillMenuToggle = (skillName: string, buttonElement: HTMLElement) => {
    if (skillMenu.isOpen && skillMenu.skillName === skillName) {
      setSkillMenu({ isOpen: false, skillName: null, anchorElement: null });
    } else {
      setSkillMenu({ isOpen: true, skillName, anchorElement: buttonElement });
    }
  };

  const handleSkillMenuClose = () => {
    setSkillMenu({ isOpen: false, skillName: null, anchorElement: null });
  };

  const handleSubAgentsAddMenuToggle = (buttonElement: HTMLElement) => {
    setSubAgentsAddMenu((prev) =>
      prev.isOpen ? { isOpen: false, anchorElement: null } : { isOpen: true, anchorElement: buttonElement },
    );
  };

  const handleSubAgentsAddMenuClose = () => {
    setSubAgentsAddMenu({ isOpen: false, anchorElement: null });
  };

  return {
    mcpServerMenu,
    skillsAddMenu,
    skillMenu,
    subAgentsAddMenu,
    handleMcpServerMenuToggle,
    handleMcpServerMenuClose,
    handleSkillsAddMenuToggle,
    handleSkillsAddMenuClose,
    handleSkillMenuToggle,
    handleSkillMenuClose,
    handleSubAgentsAddMenuToggle,
    handleSubAgentsAddMenuClose,
  };
}
