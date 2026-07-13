/**
 * DeleteSubAgentConfirmDialog
 *
 * Sub-agent 删除确认框。常驻挂载（SettingsDialogs），通过 `deleteSubAgentDialogAtom`
 * 控制 open。SubAgentListItem 调 requestDelete(name)（异步扫「被哪些 agent 使用」后开框），
 * 本组件订阅 atom 渲染确认框并执行真正的 subAgentApi.delete。
 *
 * 删除后数据由 subAgents.atom 订阅 persist:agent:registry:updated[kind=subAgents] 自动刷新。
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { subAgentApi } from '@/ipc/subAgent';
import { useToast } from '../ui/ToastProvider';
import { DeleteSubAgentDialogAtom } from './subAgentCommands.atom';

const DeleteSubAgentConfirmDialog: React.FC = () => {
  const [{ open, subAgentName, usedByAgents }, actions] = DeleteSubAgentDialogAtom.use();
  const { showSuccess, showError } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteActionRef = useRef<HTMLButtonElement>(null);

  const handleConfirm = useCallback(async () => {
    if (!subAgentName) return;
    setIsDeleting(true);
    try {
      const result = await subAgentApi.delete(subAgentName);
      if (result.success) {
        showSuccess(`Sub-agent "${subAgentName}" deleted successfully`);
      } else {
        showError(`Failed to delete sub-agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      setIsDeleting(false);
      actions.close();
    }
  }, [subAgentName, actions, showSuccess, showError]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) actions.close(); }}>
      <DialogContent className="max-w-lg" initialFocusRef={deleteActionRef}>
        <DialogHeader>
          <DialogTitle className="text-left">Delete Sub-Agent</DialogTitle>
          <DialogDescription className="text-left">
            Are you sure you want to delete {subAgentName}?
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {usedByAgents.length > 0 && (
            <p className="text-sm text-muted-foreground mb-4">
              This sub-agent is currently being used by {usedByAgents.length} agent(s): {usedByAgents.join(', ')}
            </p>
          )}
          <p className="text-sm text-destructive">
            This action cannot be undone. After deletion, agents will no longer be able to use this sub-agent.
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => actions.close()} disabled={isDeleting}>
            No
          </Button>
          <Button
            ref={deleteActionRef}
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={isDeleting}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteSubAgentConfirmDialog;
