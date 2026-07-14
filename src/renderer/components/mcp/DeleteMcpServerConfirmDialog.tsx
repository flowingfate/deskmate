import React, { useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';

interface DeleteMcpServerConfirmDialogProps {
  open: boolean;
  serverName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

const DeleteMcpServerConfirmDialog: React.FC<DeleteMcpServerConfirmDialogProps> = ({
  open,
  serverName,
  onClose,
  onConfirm,
}) => {
  const deleteActionRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-lg" initialFocusRef={deleteActionRef}>
        <DialogHeader>
          <DialogTitle className="text-left">Delete MCP Server</DialogTitle>
          <DialogDescription className="text-left">
            Are you sure you want to delete {serverName}?
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-destructive">
            This action cannot be undone. The MCP server configuration will be permanently deleted.
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            No
          </Button>
          <Button ref={deleteActionRef} variant="destructive" size="sm" onClick={() => void onConfirm()}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteMcpServerConfirmDialog;
