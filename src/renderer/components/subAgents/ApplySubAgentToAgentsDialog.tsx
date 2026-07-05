/**
 * ApplySubAgentToAgentsDialog
 *
 * Sub-agent 安装/创建后弹出，让用户选哪些 agent 应用该 sub-agent。
 * 通用列表 + 状态机抽到 `components/agentSelection/`，本文件只剩 dialog 框架 +
 * isAlreadyApplied 谓词 + handleApply 业务（逐个 updateAgent 写回 sub_agents）。
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
import { updateAgent } from '@/lib/chat/agentOps';
import { useToast } from '../ui/ToastProvider';
import {
  AgentSelectionList,
  useApplyToAgentsState,
} from '../agentSelection';

interface DialogState {
  open: boolean;
  subAgentName: string;
}

const zeroState: DialogState = { open: false, subAgentName: '' };
export const ApplySubAgentDialogAtom = atom(zeroState, (get, set) => {
  const cancel = () => set(zeroState);
  const setSubAgent = (subAgentName: string) => set({ open: true, subAgentName });
  const setOpen = (open: boolean) => set({ ...get(), open });
  return { cancel, setSubAgent, setOpen };
});

const ApplySubAgentToAgentsDialog: React.FC = () => {
  const [{ open, subAgentName }, actions] = ApplySubAgentDialogAtom.use();
  const { showSuccess, showError } = useToast();
  const [isApplying, setIsApplying] = useState(false);

  const state = useApplyToAgentsState({
    open,
    resourceKey: subAgentName,
    isAlreadyApplied: useCallback(
      (detail) => (detail.subAgents ?? []).includes(subAgentName),
      [subAgentName],
    ),
  });
  const { agentItems, selectedAgents, details, detailsReady, newlySelectedCount } = state;

  const handleApply = useCallback(async () => {
    const toApply = agentItems.filter(
      (item) => !item.alreadyApplied && selectedAgents.has(item.agentId),
    );
    if (toApply.length === 0) {
      actions.setOpen(false);
      return;
    }

    setIsApplying(true);
    let successCount = 0;
    let failCount = 0;

    for (const item of toApply) {
      const detail = details[item.agentId];
      if (!detail) continue;

      const currentSubAgents = detail.subAgents || [];
      const updatedSubAgents = [...currentSubAgents, subAgentName];

      const result = await updateAgent(item.agentId, { sub_agents: updatedSubAgents });
      if (result.success) successCount++;
      else failCount++;
    }

    setIsApplying(false);

    if (successCount > 0) {
      showSuccess(
        `Sub-agent "${subAgentName}" applied to ${successCount} agent${successCount > 1 ? 's' : ''}`,
      );
    }
    if (failCount > 0) {
      showError(
        `Failed to apply sub-agent to ${failCount} agent${failCount > 1 ? 's' : ''}`,
      );
    }

    actions.setOpen(false);
  }, [agentItems, selectedAgents, details, subAgentName, actions, showSuccess, showError]);

  const handleSkip = useCallback(() => {
    actions.setOpen(false);
  }, [actions]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={actions.setOpen}>
      <DialogContent className="w-105 max-w-105">
        <DialogHeader>
          <DialogTitle>Apply to Agents</DialogTitle>
          <DialogDescription>
            Select which agents should use the sub-agent "{subAgentName}".
          </DialogDescription>
        </DialogHeader>

        <AgentSelectionList state={state} listClassName="py-3 max-h-[320px] overflow-y-auto" />

        <DialogFooter>
          <Button variant="secondary" onClick={handleSkip} disabled={isApplying}>
            Skip
          </Button>
          <Button
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

export default ApplySubAgentToAgentsDialog;
