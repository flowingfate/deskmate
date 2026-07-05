/**
 * useAddSkillFromDevice —— 「从设备添加技能」的共享业务 hook。
 *
 * 触发源（SkillsAddMenuDropdown 菜单项、SkillsContentView 空态按钮）都是纯 IPC 调用
 * （main 进程弹原生文件/文件夹对话框），不依赖任何 renderer 局部 ref，故直接内联到各
 * producer，无需绕全局事件 / atom 中转。安装成功后：
 *   - 命中「已安装未应用」→ 弹 ApplySkillDialog 让用户选应用到哪些 agent；
 *   - 广播 SkillFolderRefreshAtom，由当前展示该 skill 的 explorer/viewer 重拉目录内容。
 */

import { useCallback } from 'react';
import { skillsApi } from '@/ipc/skill';
import { useToast } from '../ui/ToastProvider';
import { ApplySkillDialogAtom } from './ApplySkillToAgentsDialog';
import { SkillFolderRefreshAtom, type SkillAddSelectionMode } from './skillCommands.atom';

export function useAddSkillFromDevice(): (mode?: SkillAddSelectionMode) => Promise<void> {
  const { showSuccess, showError, showToast } = useToast();
  const installSkillActions = ApplySkillDialogAtom.useChange();
  const refreshFolder = SkillFolderRefreshAtom.useChange().refresh;

  return useCallback(async (selectionMode?: SkillAddSelectionMode) => {
    try {
      const result = await skillsApi.addSkillFromDevice(undefined, {
        requestSource: 'settings',
        selectionMode,
      });

      if (result.success) {
        showSuccess(result.message || `Skill "${result.skillName}" added successfully`);

        if (result.skillName) {
          const refreshedSkillName = result.skillName;
          setTimeout(() => {
            refreshFolder(refreshedSkillName);
          }, 600);
        }

        if (result.skillName && !result.isOverwrite && result.resolution === 'installed_but_not_applied') {
          installSkillActions.setSkill(result.skillName);
        }
      } else if (result.error && result.error !== 'File selection canceled' && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to add skill from device: ${errorMessage}`);
    }
  }, [showError, showSuccess, showToast, installSkillActions, refreshFolder]);
}
