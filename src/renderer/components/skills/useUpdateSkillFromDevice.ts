/**
 * useUpdateSkillFromDevice —— 「从设备更新技能」的共享业务 hook。
 *
 * 与 `useAddSkillFromDevice` 同构：main 进程弹一个原生对话框，用户在同一个框里选
 * folder / .zip / .skill。区别在于目标 skill 名不再由调用方预先指定——由所选包自身
 * `SKILL.md` 的 name 字段自动判定，main 进程据此在 profile skill 库里查找同名 skill：
 *   - 找不到 → 拒绝（提示改用 Add from Device）；
 *   - 找到 → 直接覆盖安装（isOverwrite 语义，绑定关系因 name 不变而保持不动）。
 *
 * 触发前应先由调用方（`SkillsAddButton`）展示一次性说明确认框，让用户明确「所选包
 * 必须与某个已装 skill 同名，否则会被拒绝」；本 hook 本身不再重复二次原生确认。
 */

import { useCallback } from 'react';
import { skillsApi } from '@/ipc/skill';
import { useToast } from '../ui/ToastProvider';
import { SkillFolderRefreshAtom } from './skillCommands.atom';

export function useUpdateSkillFromDevice(): () => Promise<void> {
  const { showSuccess, showError, showToast } = useToast();
  const refreshFolder = SkillFolderRefreshAtom.useChange().refresh;

  return useCallback(async () => {
    try {
      const result = await skillsApi.updateSkillFromDevice();

      if (result.success) {
        showSuccess(`Skill "${result.skillName}" updated successfully`);

        if (result.skillName) {
          const refreshedSkillName = result.skillName;
          setTimeout(() => {
            refreshFolder(refreshedSkillName);
          }, 600);
        }
      } else if (result.error && result.error !== 'File selection canceled' && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to update skill from device: ${errorMessage}`);
    }
  }, [showError, showSuccess, showToast, refreshFolder]);
}
