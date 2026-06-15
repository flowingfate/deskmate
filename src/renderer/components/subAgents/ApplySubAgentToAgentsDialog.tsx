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
import { updateAgent } from '@/lib/chat/agentOps';
import { useToast } from '../ui/ToastProvider';
import {
  AgentSelectionList,
  useApplyToAgentsState,
} from '../agentSelection';

interface ApplySubAgentToAgentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subAgentName: string;
}

const ApplySubAgentToAgentsDialog: React.FC<ApplySubAgentToAgentsDialogProps> = ({
  open,
  onOpenChange,
  subAgentName,
}) => {
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
      onOpenChange(false);
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

    onOpenChange(false);
  }, [agentItems, selectedAgents, details, subAgentName, onOpenChange, showSuccess, showError]);

  const handleSkip = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] max-w-[420px]">
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
