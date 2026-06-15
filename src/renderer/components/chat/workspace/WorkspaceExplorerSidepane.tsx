import React from 'react';
import './WorkspaceExplorerSidepane.scss';
import { ScrollArea } from '@/shadcn/scroll-area';
import { useCurrentChatSessionId, useCurrentAgentId } from '../../../lib/chat/agentSessionCacheManager';
import FileExplorerSection from './FileExplorerSection';
import { WorkspaceMenuAtom } from '@renderer/components/menu/WorkspaceMenuDropdown';
import { WorkspaceExplorerAtom } from '../chat-side.atom';

export interface WorkspaceMenuActions {
  onOpenInExplorer: () => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onPasteToWorkspace: () => void;
  canOpenInExplorer: boolean;
  canAddFiles: boolean;
  canAddFolder: boolean;
  canPasteToWorkspace: boolean;
  workspacePath: string;
}

/**
 * 新 persist 模型只剩两层"文件根",两个 section 都用 URI 抽象:
 * - Agent 级公共路径:`knowledge://` —— FileExplorerSection 内部用 `resolveUriToPath`
 *   翻成绝对路径(由 main 端 `KnowledgeProtocolHandler.resolveToPath` 解析占位符 +
 *   AGENT.md `knowledge.knowledgeBase` 字段,未配置走默认 `${agentRoot}/knowledge`)
 * - Session 级私有路径:`local://` —— 同理走 `LocalProtocolHandler.resolveToPath`
 *
 * 本组件不再读 `useAgentDetail()?.knowledge?.knowledgeBase`,也不再调
 * `useSessionFilesDir` —— URI 抽象掉了"调用方该问谁要绝对路径"这件事。
 */
const WorkspaceExplorerSidepane: React.FC = () => {
  const [
    { visible: isVisible, reveal: revealRequest },
    { cancelReveal: onRevealHandled },
  ] = WorkspaceExplorerAtom.use();
  const { toggle: onMenuToggle } = WorkspaceMenuAtom.useChange();

  const currentAgentId = useCurrentAgentId();
  const currentChatSessionId = useCurrentChatSessionId();

  if (!isVisible) {
    return null;
  }

  return (
    <ScrollArea className="file-explorer-sidepane flex-1 min-h-0">
      <div className="flex flex-col">
        {/* Agent Knowledge — knowledge:// (空 path = KB 根目录) */}
        <FileExplorerSection
          title="Agent Knowledge Files"
          rootUri="knowledge://"
          currentAgentId={currentAgentId}
          currentChatSessionId={currentChatSessionId}
          revealRequest={revealRequest}
          onRevealHandled={onRevealHandled}
          onMenuToggle={onMenuToggle}
        />

        {/* Session Deliverables — local:// (空 path = session sandbox 根目录) */}
        <FileExplorerSection
          title="Current Chat Session Deliverables"
          className="border-t border-black/7"
          emptyMessage="Files generated during the current chat session will appear here."
          readOnly
          rootUri="local://"
          currentAgentId={currentAgentId}
          currentChatSessionId={currentChatSessionId}
          revealRequest={revealRequest}
          onRevealHandled={onRevealHandled}
          onMenuToggle={onMenuToggle}
        />
      </div>
    </ScrollArea>
  );
};

export default WorkspaceExplorerSidepane;
