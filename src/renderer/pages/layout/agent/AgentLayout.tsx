import React, { useEffect, useCallback, memo } from 'react';
import { useCurrentAgentId } from '@/lib/chat/agentSessionCacheManager';
import { useToast } from '@/components/ui/ToastProvider';
import { PasteToWorkspaceProvider } from '@/components/chat/workspace/PasteToWorkspaceProvider';
import { log } from '@/log';
import { AgentLayoutContent } from './AgentLayoutContent';


import { addFileToKnowledgeBase } from '@/lib/chat/addToKnowledgeBase';
import { ApplySkillDialogAtom } from '@/components/skills/ApplySkillToAgentsDialog';
import { SkillFolderRefreshAtom } from '@/components/skills/skillCommands.atom';
import ModifyMessageConfim from '@/components/overlay/ModifyMsgConfimOverlay';
import { appEvents } from '@/ipc/app';
import { workspaceApi } from '@/ipc/workspace';
import { skillsApi } from '@/ipc/skill';
const logger = log.child({ mod: 'AgentLayout' });

const AgentLayout: React.FC = () => {
  // Toast for KB / skill-install / debug-info flows
  const { showToast, showSuccess, showError } = useToast();

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
  const refreshFolder = SkillFolderRefreshAtom.useChange().refresh;


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
        // Trigger skills folder explorer refresh
        if (result.skillName) {
          const refreshedSkillName = result.skillName;
          setTimeout(() => {
            refreshFolder(refreshedSkillName);
          }, 600);
        }

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
  }, [reactiveAgentId, showSuccess, showError, showToast, installSkillActions, refreshFolder]);

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