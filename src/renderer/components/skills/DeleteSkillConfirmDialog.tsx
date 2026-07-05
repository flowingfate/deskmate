/**
 * DeleteSkillConfirmDialog
 *
 * Skill 删除确认框。常驻挂载（SettingsDialogs），通过 `DeleteSkillDialogAtom` 控制 open。
 * SkillDropdownMenu 调 requestDelete(name)（异步扫「被哪些 agent 使用」后开框），本组件
 * 订阅 atom 渲染确认框并执行真正的 skillsApi.deleteSkill。
 *
 * 删除后数据由 skills.atom 订阅 persist:agent:registry:updated[kind=skills] 自动刷新。
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
import { skillsApi } from '@/ipc/skill';
import { useToast } from '../ui/ToastProvider';
import { DeleteSkillDialogAtom } from './skillCommands.atom';

const DeleteSkillConfirmDialog: React.FC = () => {
  const [{ open, skillName, usedByAgents }, actions] = DeleteSkillDialogAtom.use();
  const { showSuccess, showError } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!skillName) return;
    setIsDeleting(true);
    try {
      if (!skillsApi?.deleteSkill) {
        showError('Skill deletion API not available');
        return;
      }
      const result = await skillsApi.deleteSkill(skillName);
      if (result.success) {
        showSuccess(`Skill "${skillName}" deleted successfully`);
      } else {
        showError(`Failed to delete skill: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      setIsDeleting(false);
      actions.close();
    }
  }, [skillName, actions, showSuccess, showError]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) actions.close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left">Delete Skill</DialogTitle>
          <DialogDescription className="text-left">
            Are you sure you want to delete {skillName}?
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {usedByAgents.length > 0 && (
            <p className="text-sm text-muted-foreground mb-4">
              This skill is currently being used by {usedByAgents.length} agent(s): {usedByAgents.join(', ')}
            </p>
          )}
          <p className="text-sm text-destructive">
            This action cannot be undone. After deletion, agents will no longer be able to use this skill.
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => actions.close()} disabled={isDeleting}>
            No
          </Button>
          <Button
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

export default DeleteSkillConfirmDialog;
