import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import ApplySkillToAgentsDialog from '@/components/skills/ApplySkillToAgentsDialog';
import ApplySubAgentToAgentsDialog from '@/components/subAgents/ApplySubAgentToAgentsDialog';
import type { SettingsActions } from './useSettingsActions';

type SettingsDialogsProps = Pick<
  SettingsActions,
  | 'deleteSkillDialog'
  | 'setDeleteSkillDialog'
  | 'handleConfirmDeleteSkill'
  | 'deleteMcpDialog'
  | 'setDeleteMcpDialog'
  | 'handleConfirmDeleteMcp'
  | 'deleteSubAgentDialog'
  | 'setDeleteSubAgentDialog'
  | 'handleConfirmDeleteSubAgent'
  | 'applySubAgentDialogState'
  | 'setApplySubAgentDialogState'
>;

const SettingsDialogs: React.FC<SettingsDialogsProps> = ({
  deleteSkillDialog,
  setDeleteSkillDialog,
  handleConfirmDeleteSkill,
  deleteMcpDialog,
  setDeleteMcpDialog,
  handleConfirmDeleteMcp,
  deleteSubAgentDialog,
  setDeleteSubAgentDialog,
  handleConfirmDeleteSubAgent,
  applySubAgentDialogState,
  setApplySubAgentDialogState,
}) => {
  return (
    <>
      {/* Delete Skill Confirmation Dialog */}
      <Dialog
        open={deleteSkillDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteSkillDialog({ isOpen: false, skillName: null, usedByAgents: [] });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Delete Skill</DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to delete {deleteSkillDialog.skillName}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {deleteSkillDialog.usedByAgents.length > 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                This skill is currently being used by {deleteSkillDialog.usedByAgents.length} agent(s): {deleteSkillDialog.usedByAgents.join(', ')}
              </p>
            )}
            <p className="text-sm text-destructive">
              This action cannot be undone. After deletion, agents will no longer be able to use this skill.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDeleteSkillDialog({ isOpen: false, skillName: null, usedByAgents: [] })}
            >
              No
            </Button>
            <Button
              variant="destructive"
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleConfirmDeleteSkill}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Sub-Agent Confirmation Dialog */}
      <Dialog
        open={deleteSubAgentDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteSubAgentDialog({ isOpen: false, subAgentName: null, usedByAgents: [] });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Delete Sub-Agent</DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to delete {deleteSubAgentDialog.subAgentName}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {deleteSubAgentDialog.usedByAgents.length > 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                This sub-agent is currently being used by {deleteSubAgentDialog.usedByAgents.length} agent(s): {deleteSubAgentDialog.usedByAgents.join(', ')}
              </p>
            )}
            <p className="text-sm text-destructive">
              This action cannot be undone. After deletion, agents will no longer be able to use this sub-agent.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDeleteSubAgentDialog({ isOpen: false, subAgentName: null, usedByAgents: [] })}
            >
              No
            </Button>
            <Button
              variant="destructive"
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleConfirmDeleteSubAgent}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete MCP Server Confirmation Dialog */}
      <Dialog
        open={deleteMcpDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteMcpDialog({ isOpen: false, serverName: null });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Delete MCP Server</DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to delete {deleteMcpDialog.serverName}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-destructive">
              This action cannot be undone. The MCP server configuration will be permanently deleted.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setDeleteMcpDialog({ isOpen: false, serverName: null })}
            >
              No
            </Button>
            <Button
              variant="destructive"
              className="bg-destructive hover:bg-destructive/90"
              onClick={handleConfirmDeleteMcp}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApplySkillToAgentsDialog />

      <ApplySubAgentToAgentsDialog
        open={applySubAgentDialogState.open}
        onOpenChange={(open) => setApplySubAgentDialogState(prev => ({ ...prev, open }))}
        subAgentName={applySubAgentDialogState.subAgentName}
      />
    </>
  );
};

export default SettingsDialogs;
