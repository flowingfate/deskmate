/**
 * useAddSkillFromDevice —— 「从设备添加技能」的共享业务 hook。
 *
 * 触发源（SkillsAddButton 下拉项、SkillsContentView 空态按钮）都是纯 IPC 调用
 * （main 进程弹一个原生对话框，用户在同一个框里选 folder / .zip / .skill：mac/Linux
 * 单对话框即可，Windows 因原生限制先弹类型选择），不依赖任何 renderer 局部 ref。
 * 安装成功后：
 *   - 命中「已安装未应用」→ 弹 ApplySkillDialog 让用户选应用到哪些 agent；
 *   - 广播 SkillFolderRefreshAtom，由当前展示该 skill 的 explorer/viewer 重拉目录内容。
 */

import { useCallback } from 'react';
import { skillsApi } from '@/ipc/skill';
import { useToast } from '../ui/ToastProvider';
import { ApplySkillDialogAtom } from './ApplySkillToAgentsDialog';
import { SkillFolderRefreshAtom } from './skillCommands.atom';

export function useAddSkillFromDevice(): () => Promise<void> {
  const { showSuccess, showError, showToast } = useToast();
  const installSkillActions = ApplySkillDialogAtom.useChange();
  const refreshFolder = SkillFolderRefreshAtom.useChange().refresh;

  return useCallback(async () => {
    try {
      const result = await skillsApi.addSkillFromDevice(undefined, {
        requestSource: 'settings',
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
