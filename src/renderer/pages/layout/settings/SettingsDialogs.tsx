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
import DeleteSkillConfirmDialog from '@/components/skills/DeleteSkillConfirmDialog';
import ApplySkillToAgentsDialog from '@/components/skills/ApplySkillToAgentsDialog';
import ApplySubAgentToAgentsDialog from '@/components/subAgents/ApplySubAgentToAgentsDialog';
import DeleteSubAgentConfirmDialog from '@/components/subAgents/DeleteSubAgentConfirmDialog';
import type { SettingsActions } from './useSettingsActions';

type SettingsDialogsProps = Pick<
  SettingsActions,
  | 'deleteMcpDialog'
  | 'setDeleteMcpDialog'
  | 'handleConfirmDeleteMcp'
>;

const SettingsDialogs: React.FC<SettingsDialogsProps> = ({
  deleteMcpDialog,
  setDeleteMcpDialog,
  handleConfirmDeleteMcp,
}) => {
  return (
    <>
      <DeleteSkillConfirmDialog />

      <DeleteSubAgentConfirmDialog />

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
              size="sm"
              onClick={() => setDeleteMcpDialog({ isOpen: false, serverName: null })}
            >
              No
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmDeleteMcp}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApplySkillToAgentsDialog />

      <ApplySubAgentToAgentsDialog />
    </>
  );
};

export default SettingsDialogs;
