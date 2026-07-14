import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/ToastProvider';
import { mcpClientCacheManager } from '@/lib/mcp/mcpClientCacheManager';
import { mcpApi } from '@/ipc/mcp';

export type McpServerOperation = 'connect' | 'disconnect' | 'reconnect';

export interface McpServerOperationState {
  isOperating: boolean;
  operation: McpServerOperation;
}

interface DeleteMcpServerDialogState {
  open: boolean;
  serverName: string;
}

const emptyDeleteDialogState: DeleteMcpServerDialogState = {
  open: false,
  serverName: '',
};

interface McpServerActions {
  operationStates: Record<string, McpServerOperationState>;
  connect: (serverName: string) => Promise<void>;
  disconnect: (serverName: string) => Promise<void>;
  reconnect: (serverName: string) => Promise<void>;
  requestDelete: (serverName: string) => void;
  closeDelete: () => void;
  confirmDelete: () => Promise<void>;
  edit: (serverName: string) => void;
  deleteDialog: DeleteMcpServerDialogState;
}

function withoutOperation(
  states: Record<string, McpServerOperationState>,
  serverName: string,
): Record<string, McpServerOperationState> {
  const { [serverName]: _, ...remainingStates } = states;
  return remainingStates;
}

async function invokeMcpOperation(
  serverName: string,
  operation: McpServerOperation,
): Promise<{ success: boolean; error?: string }> {
  switch (operation) {
    case 'connect':
      return mcpApi.connectServer(serverName);
    case 'disconnect':
      return mcpApi.disconnectServer(serverName);
    case 'reconnect':
      return mcpApi.reconnectServer(serverName);
  }
}

export function useMcpServerActions(): McpServerActions {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const [operationStates, setOperationStates] = useState<Record<string, McpServerOperationState>>({});
  const [deleteDialog, setDeleteDialog] = useState<DeleteMcpServerDialogState>(emptyDeleteDialogState);

  const performOperation = useCallback(
    async (serverName: string, operation: McpServerOperation): Promise<void> => {
      setOperationStates((states) => ({
        ...states,
        [serverName]: { isOperating: true, operation },
      }));

      try {
        const result = await invokeMcpOperation(serverName, operation);
        if (!result.success) {
          throw new Error(result.error || `Failed to ${operation} server`);
        }

        if (operation === 'disconnect') {
          showSuccess(`Server "${serverName}" disconnected successfully`);
        }
        await mcpClientCacheManager.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        showError(`Failed to ${operation} server: ${message}`);
      } finally {
        setOperationStates((states) => withoutOperation(states, serverName));
      }
    },
    [showError, showSuccess],
  );

  const connect = useCallback(
    (serverName: string): Promise<void> => performOperation(serverName, 'connect'),
    [performOperation],
  );
  const disconnect = useCallback(
    (serverName: string): Promise<void> => performOperation(serverName, 'disconnect'),
    [performOperation],
  );
  const reconnect = useCallback(
    (serverName: string): Promise<void> => performOperation(serverName, 'reconnect'),
    [performOperation],
  );
  const requestDelete = useCallback((serverName: string): void => {
    setDeleteDialog({ open: true, serverName });
  }, []);
  const closeDelete = useCallback((): void => {
    setDeleteDialog(emptyDeleteDialogState);
  }, []);
  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!deleteDialog.serverName) return;

    try {
      const result = await mcpApi.deleteServer(deleteDialog.serverName);
      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }
      showSuccess(`Server "${deleteDialog.serverName}" deleted successfully`);
      await mcpClientCacheManager.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to delete server: ${message}`);
    } finally {
      closeDelete();
    }
  }, [closeDelete, deleteDialog.serverName, showError, showSuccess]);
  const edit = useCallback(
    (serverName: string): void => {
      void navigate(`/settings/mcp/edit/${encodeURIComponent(serverName)}`);
    },
    [navigate],
  );

  return {
    operationStates,
    connect,
    disconnect,
    reconnect,
    requestDelete,
    closeDelete,
    confirmDelete,
    edit,
    deleteDialog,
  };
}
