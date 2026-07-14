/**
 * ApplySkillToAgentsDialog
 *
 * Skill 添加后弹出，让用户选哪些 agent 应用该 skill。常驻挂载于 `AgentLayoutContent`
 *（agent 路由）或 `SkillsView`（Settings 路由），通过 `ApplySkillDialogAtom` 控制 open。
 *
 * 通用列表 + 状态机抽到 `components/agentSelection/`，本文件只剩：
 *   - 通过 atom 控制的 dialog 框架
 *   - 资源特定的 isAlreadyApplied 谓词
 *   - handleApply：调用 `skillsApi.applySkillToAgents` 的真实业务
 */

import React, { useCallback, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { atom } from '@/atom';
import { skillsApi } from '@/ipc/skill';
import { useToast } from '../ui/ToastProvider';
import {
  AgentSelectionList,
  useApplyToAgentsState,
} from '../agentSelection';

interface DialogState {
  open: boolean;
  skillName: string;
}

const zeroState: DialogState = { open: false, skillName: '' };
export const ApplySkillDialogAtom = atom(zeroState, (get, set) => {
  const cancel = () => set(zeroState);
  const setSkill = (skillName: string) => set({ open: true, skillName });
  const setOpen = (open: boolean) => set({ ...get(), open });
  return { cancel, setSkill, setOpen };
});

const ApplySkillToAgentsDialog: React.FC = () => {
  const [{ open, skillName }, actions] = ApplySkillDialogAtom.use();
  const { showSuccess, showError } = useToast();
  const [isApplying, setIsApplying] = useState(false);

  const state = useApplyToAgentsState({
    open,
    resourceKey: skillName,
    isAlreadyApplied: useCallback(
      (detail) => (detail.skills ?? {})[skillName] !== undefined,
      [skillName],
    ),
  });
  const { agentItems, selectedAgents, detailsReady, newlySelectedCount } = state;

  const handleApply = useCallback(async () => {
    const toApply = agentItems.filter(
      (item) => !item.alreadyApplied && selectedAgents.has(item.agentId),
    );
    if (toApply.length === 0) {
      actions.setOpen(false);
      return;
    }

    setIsApplying(true);
    const result = await skillsApi.applySkillToAgents(
      skillName,
      toApply.map((item) => ({ agentId: item.agentId, agentName: item.agentName })),
    );
    setIsApplying(false);

    if (!result.success && result.appliedCount === 0) {
      showError(result.message || result.error || `Failed to apply skill "${skillName}"`);
      return;
    }

    if (result.appliedCount > 0) {
      showSuccess(
        `Skill "${skillName}" applied to ${result.appliedCount} agent${result.appliedCount > 1 ? 's' : ''}`,
      );
    }

    if (result.failedCount > 0) {
      showError(
        `Failed to apply skill to ${result.failedCount} agent${result.failedCount > 1 ? 's' : ''}`,
      );
    }

    actions.setOpen(false);
  }, [agentItems, selectedAgents, skillName, actions, showSuccess, showError]);

  const handleSkip = useCallback(() => {
    actions.setOpen(false);
  }, [actions]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={actions.setOpen}>
      <DialogContent className="w-[480px] max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Apply to Agents</DialogTitle>
          <DialogDescription>
            Select which agents should use the skill "{skillName}".
          </DialogDescription>
        </DialogHeader>

        <AgentSelectionList state={state} />

        <DialogFooter>
          <Button variant="outline" onClick={handleSkip} disabled={isApplying}>
            Skip
          </Button>
          <Button
            variant="default"
            onClick={handleApply}
            disabled={isApplying || !detailsReady || newlySelectedCount === 0}
          >
            {isApplying ? 'Applying...' : `Apply${newlySelectedCount > 0 ? ` (${newlySelectedCount})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ApplySkillToAgentsDialog;
