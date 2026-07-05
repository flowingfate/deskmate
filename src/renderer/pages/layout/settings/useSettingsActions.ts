import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/ToastProvider';
import { mcpClientCacheManager } from '@/lib/mcp/mcpClientCacheManager';
import { mcpApi } from '@/ipc/mcp';

export interface SettingsActions {
  // MCP operations
  handleMcpServerConnect: (serverName: string) => Promise<void>;
  handleMcpServerDisconnect: (serverName: string) => Promise<void>;
  handleMcpServerReconnect: (serverName: string) => Promise<void>;
  handleMcpServerDelete: (serverName: string) => void;
  handleMcpServerEdit: (serverName: string) => void;

  // Dialog states
  deleteMcpDialog: { isOpen: boolean; serverName: string | null };
  setDeleteMcpDialog: React.Dispatch<React.SetStateAction<{ isOpen: boolean; serverName: string | null }>>;
  handleConfirmDeleteMcp: () => Promise<void>;
}

export function useSettingsActions(): SettingsActions {
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [deleteMcpDialog, setDeleteMcpDialog] = useState<{
    isOpen: boolean;
    serverName: string | null;
  }>({ isOpen: false, serverName: null });

  // MCP server operations
  const handleMcpServerConnect = useCallback(async (serverName: string) => {
    try {
      const result = await mcpApi.connectServer(serverName);
      if (result.success) {
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to connect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to connect server: ${errorMessage}`);
    }
  }, [showError]);

  const handleMcpServerDisconnect = useCallback(async (serverName: string) => {
    try {
      const result = await mcpApi.disconnectServer(serverName);
      if (result.success) {
        showSuccess(`Server "${serverName}" disconnected successfully`);
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to disconnect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to disconnect server: ${errorMessage}`);
    }
  }, [showError, showSuccess]);

  const handleMcpServerReconnect = useCallback(async (serverName: string) => {
    try {
      const result = await mcpApi.reconnectServer(serverName);
      if (result.success) {
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to reconnect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to reconnect server: ${errorMessage}`);
    }
  }, [showError]);

  const handleMcpServerDelete = useCallback((serverName: string) => {
    setDeleteMcpDialog({ isOpen: true, serverName });
  }, []);

  const handleMcpServerEdit = useCallback((serverName: string) => {
    navigate(`/settings/mcp/edit/${encodeURIComponent(serverName)}`);
  }, [navigate]);

  // Confirm MCP deletion
  const handleConfirmDeleteMcp = useCallback(async () => {
    const { serverName } = deleteMcpDialog;
    if (!serverName) return;

    try {
      const result = await mcpApi.deleteServer(serverName);
      if (result.success) {
        showSuccess(`Server "${serverName}" deleted successfully`);
        await mcpClientCacheManager.refresh();
      } else {
        showError(`Failed to delete server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to delete server: ${errorMessage}`);
    } finally {
      setDeleteMcpDialog({ isOpen: false, serverName: null });
    }
  }, [deleteMcpDialog, showError, showSuccess]);

  return {
    handleMcpServerConnect,
    handleMcpServerDisconnect,
    handleMcpServerReconnect,
    handleMcpServerDelete,
    handleMcpServerEdit,
    deleteMcpDialog,
    setDeleteMcpDialog,
    handleConfirmDeleteMcp,
  };
}
