import React from 'react';
import { useLocation } from 'react-router-dom';
import { LeftNavCollapsedAtom, LeftNavSizeAtom } from '@/states/left-nav.atom';
import { RightPaneCollapsedAtom } from '@/states/right-pane.atom';
import SessionPanel from '@/components/agent-side/SessionPanel';
import ContentContainer from './ContentContainer';
import ResizableDivider from '@/components/ui/ResizableDivider';
import RightResizableDivider from '@/components/ui/RightResizableDivider';
import { RightGlobalSidepane } from './RightGlobalSidepane';
import { OverlayImageViewer } from '@/components/ui/OverlayImageViewer';
import { OverlayFileViewer } from '@/components/ui/OverlayFileViewer';
import ApplySkillToAgentsDialog from '@/components/skills/ApplySkillToAgentsDialog';
import {
  AgentDropdownMenu,
  WorkspaceMenuDropdown,
  EditAgentMenuDropdown,
  AttachMenuDropdown,
  ChatSessionDropdownMenu,
  FileTreeNodeContextMenu,
  ImageGalleryContextMenu,
} from '@/components/menu';
import { DeleteOverlay } from '@/components/overlay/DeleteOverlay';
import { DuplicateAgentOverlay } from '@/components/overlay/DuplicateAgentOverlay';
import { RenameChatSessionOverlay } from '@/components/overlay/RenameChatSessionOverlay';

interface AgentLayoutContentProps {
  handleFileTreeNodeInstallSkill: (filePath: string) => void;
  handleFileTreeNodeAddToKnowledge: (filePath: string) => void;
}

export const AgentLayoutContent: React.FC<AgentLayoutContentProps> = ({
  handleFileTreeNodeInstallSkill,
  handleFileTreeNodeAddToKnowledge,
}) => {
  const location = useLocation();

  const [leftPanelCollapsed] = LeftNavCollapsedAtom.use();
  const { width: leftNavWidth, resizing: leftNavResizing } = LeftNavSizeAtom.useData();
  const isCreationRoute = location.pathname.startsWith('/agent/creation');
  const isSessionPanelVisible = !leftPanelCollapsed && !isCreationRoute;

  const [rightPanelCollapsed] = RightPaneCollapsedAtom.use();
  const isRightPaneVisible = !rightPanelCollapsed;

  return (
    <div
      className={[
        'app-layout',
        leftPanelCollapsed ? 'left-panel-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="app-body">

        {/* SessionPanel — agent header + session list */}
        <div
          className={`session-panel-wrapper ${isSessionPanelVisible ? '' : 'collapsed'} relative`}
          style={{
            width: isSessionPanelVisible ? leftNavWidth : 0,
            flexShrink: 0,
            transition: leftNavResizing ? 'unset' : 'width 0.2s ease',
            overflow: 'hidden',
          }}
        >
          <SessionPanel />
        </div>

        {isSessionPanelVisible && <ResizableDivider />}

        <ContentContainer />

        {isRightPaneVisible && <RightResizableDivider />}
        {isRightPaneVisible && <RightGlobalSidepane />}

        <AgentDropdownMenu />
        <WorkspaceMenuDropdown />
        <EditAgentMenuDropdown />
        <AttachMenuDropdown />
        <ChatSessionDropdownMenu />

        <FileTreeNodeContextMenu
          onInstallSkill={handleFileTreeNodeInstallSkill}
          onAddToKnowledge={handleFileTreeNodeAddToKnowledge}
        />

        <ImageGalleryContextMenu />
        <DeleteOverlay />
        <DuplicateAgentOverlay />
        <RenameChatSessionOverlay />
        <OverlayImageViewer />
        <OverlayFileViewer onInstallSkill={handleFileTreeNodeInstallSkill} />
        <ApplySkillToAgentsDialog />
      </div>
    </div>
  );
};
