import React, { useEffect, useCallback, memo } from 'react';
import { useCurrentAgentId, agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import { useToast } from '@/components/ui/ToastProvider';
import { PasteToWorkspaceProvider } from '@/components/chat/workspace/PasteToWorkspaceProvider';
import { log } from '@/log';
import { AgentLayoutContent } from './AgentLayoutContent';


import { addFileToKnowledgeBase } from '@/lib/chat/addToKnowledgeBase';
import { getSessionEntry } from '@/states/sessionIndex.atom';
import { DeleteConfirmAtom } from '@/components/overlay/DeleteOverlay';
import { RenameChatSessionAtom } from '@/components/overlay/RenameChatSessionOverlay';
import { ApplySkillDialogAtom } from '@/components/skills/ApplySkillToAgentsDialog';
import ModifyMessageConfim from '@/components/overlay/ModifyMsgConfimOverlay';
import { appEvents } from '@/ipc/app';
import { persistApi } from '@/ipc/persist';
import { chatSessionApi } from '@/ipc/chatSession';
import { workspaceApi } from '@/ipc/workspace';
import { skillsApi } from '@/ipc/skill';

import './Agent.scss';
const logger = log.child({ mod: 'AgentLayout' });

const AgentLayout: React.FC = () => {
  // Delete confirmation dialog state (for agents and chat sessions)
  const deleteConfirmActions = DeleteConfirmAtom.useChange();
  // Rename chat session dialog state
  const renameChatSessionActions = RenameChatSessionAtom.useChange();

  // Delete confirmation handler
  const { showToast, showSuccess, showError } = useToast();

  const handleToggleChatSessionStar = useCallback(async (agentId: string, sessionId: string, starred: boolean) => {
    try {
      const result = await persistApi.setSessionStarred(
        agentId,
        sessionId,
        starred,
      );

      if (result?.success) {
        showSuccess(starred ? 'Session starred' : 'Session unstarred');
      } else {
        showError(result?.error || 'Failed to update chat session star state');
      }
    } catch (error) {
      showError('Failed to update chat session star state');
    }
  }, [showError, showSuccess]);

  // Reactively get the current agentId; auto-updates when switching Agents
  const reactiveAgentId = useCurrentAgentId();

  // KB 路径不在 renderer 层穿透 props —— `addFileToKnowledgeBase`
  // 内部用 `knowledge://` 自解析当前 agent 的 KB 根。本组件只负责把 fileTree
  // 节点的绝对路径(node.path 由文件树构造,本身是 abs)交给 add-to-KB 流程。
  const handleFileTreeNodeAddToKnowledge = useCallback(async (filePath: string) => {
    try {
      const result = await addFileToKnowledgeBase(filePath);

      if (!result.success && result.error && result.error !== 'User cancelled replacement') {
        const errMsg = result.error;
        const userMsg = errMsg.includes('EACCES')
          ? `Permission denied.\n\nThe app cannot access this file or folder. Please grant access in System Settings → Privacy & Security → Files and Folders, then try again.`
          : `Failed to add file: ${errMsg}`;
        window.alert(userMsg);
      }
    } catch (error) {
      logger.error({ msg: "Error adding file to knowledge:", err: error });
      const errMsg = error instanceof Error ? error.message : String(error);
      const userMsg = errMsg.includes('EACCES')
        ? `Permission denied.\n\nThe app cannot access this file or folder. Please grant access in System Settings → Privacy & Security → Files and Folders, then try again.`
        : `Failed to add file: ${errMsg}`;
      window.alert(userMsg);
    }
  }, []);

  // Install skill from file tree node
  const installSkillActions = ApplySkillDialogAtom.useChange();


  const handleFileTreeNodeInstallSkill = useCallback(async (filePath: string) => {
    try {
      if (!skillsApi?.installSkillFromFilePath) {
        showError('Install skill API not available');
        return;
      }

      const result = await skillsApi.installSkillFromFilePath(filePath, {
        agentId: reactiveAgentId || undefined,
        applyToCurrentAgent: !!reactiveAgentId,
        requestSource: 'file-tree',
      });

      if (result.success) {
        showSuccess(result.message || `Skill "${result.skillName}" installed successfully`);
        // Trigger skills list refresh
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
            detail: { skillName: result.skillName }
          }));
        }, 600);

        // Fall back to manual target selection only when current chat activation stays ambiguous.
        if (result.skillName && result.resolution === 'installed_but_needs_target_selection') {
          installSkillActions.setSkill(result.skillName);
        }
      } else if (result.error && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to install skill: ${errorMessage}`);
    }
  }, [reactiveAgentId, showSuccess, showError, showToast]);

  // Handle showing delete confirmation dialog for chat sessions
  const handleShowDeleteChatSessionConfirm = useCallback(
    (sessionId: string) => {
      const currentSessionId =
        agentSessionCacheManager.getCurrentChatSessionId();
      const isCurrentSession = currentSessionId === sessionId;

      const currentAgentId = agentSessionCacheManager.getCurrentAgentId();
      const entry = getSessionEntry(currentAgentId, sessionId);
      const sessionTitle = entry?.title || 'Unnamed Session';
      deleteConfirmActions.showChatSession(sessionId, sessionTitle, isCurrentSession);
    },
    [deleteConfirmActions],
  );

  // Listen for delete events
  useEffect(() => {
    const handleDeleteChatSessionEvent = (event: CustomEvent) => {
      const { sessionId } = event.detail;
      handleShowDeleteChatSessionConfirm(sessionId);
    };

    const handleRenameChatSessionEvent = (event: CustomEvent) => {
      const { agentId, sessionId, title } = event.detail;
      renameChatSessionActions.show(agentId, sessionId, title);
    };

    const handleToggleChatSessionStarEvent = (event: CustomEvent) => {
      const { agentId, sessionId, starred } = event.detail;
      void handleToggleChatSessionStar(agentId, sessionId, starred);
    };

    window.addEventListener(
      'chatSession:delete',
      handleDeleteChatSessionEvent as EventListener,
    );
    window.addEventListener(
      'chatSession:rename',
      handleRenameChatSessionEvent as EventListener,
    );
    window.addEventListener(
      'chatSession:toggleStar',
      handleToggleChatSessionStarEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'chatSession:delete',
        handleDeleteChatSessionEvent as EventListener,
      );
      window.removeEventListener(
        'chatSession:rename',
        handleRenameChatSessionEvent as EventListener,
      );
      window.removeEventListener(
        'chatSession:toggleStar',
        handleToggleChatSessionStarEvent as EventListener,
      );
    };
  }, [
    handleShowDeleteChatSessionConfirm,
    handleToggleChatSessionStar,
  ]);

  // 🔥 Listen for download ChatSession events
  useEffect(() => {
    const handleDownloadChatSessionEvent = async (event: Event) => {
      const customEvent = event as CustomEvent<{
        agentId: string;
        sessionId: string;
        title: string;
      }>;
      const { agentId, sessionId, title } = customEvent.detail;

      try {
        const result = await chatSessionApi.downloadChatSession(
          agentId,
          sessionId,
          title
        );

        if (result.success) {
          // Success: persistent toast + Open Folder button
          showToast(
            `Chat session saved as "${result.fileName}"`,
            'success',
            undefined,
            {
              persistent: true,
              actions: [
                {
                  label: 'Open Folder',
                  variant: 'primary' as const,
                  onClick: () => {
                    workspaceApi.showInFolder(result.filePath);
                  }
                }
              ]
            }
          );
        } else {
          // Failure: non-persistent toast
          showError(result.error || 'Failed to download chat session');
        }
      } catch (error) {
        showError('Failed to download chat session');
      }
    };

    window.addEventListener(
      'chatSession:download',
      handleDownloadChatSessionEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'chatSession:download',
        handleDownloadChatSessionEvent as EventListener,
      );
    };
  }, [showToast, showError]);

  useEffect(() => {
    const cleanup = appEvents.debugInfoDownloaded((_event, result) => {
      if (result?.success && result.filePath) {
        showToast(
          `Debug info saved as "${result.fileName || 'debug info zip'}"`,
          'success',
          undefined,
          {
            persistent: true,
            actions: [
              {
                label: 'Open Folder',
                variant: 'primary' as const,
                onClick: () => {
                  workspaceApi.showInFolder(result.filePath!);
                }
              }
            ]
          }
        );
        return;
      }

      showError(result?.error || 'Failed to export debug info');
    });

    return cleanup;
  }, [showToast, showError]);

  return (
    <PasteToWorkspaceProvider>
      <AgentLayoutContent
        handleFileTreeNodeInstallSkill={handleFileTreeNodeInstallSkill}
        handleFileTreeNodeAddToKnowledge={handleFileTreeNodeAddToKnowledge}
      />
      <ModifyMessageConfim />
    </PasteToWorkspaceProvider>
  );
};

export default memo(AgentLayout);