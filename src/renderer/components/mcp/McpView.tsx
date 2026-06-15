'use client'

import React, { useState, useCallback } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Cable, Plus } from 'lucide-react';
import { Badge } from '@/shadcn/badge';
import { Button } from '@/shadcn/button';
import {
  useMcpRuntimeServers,
  useMcpRuntimeStats,
  refreshMcpRuntime,
} from '@/states/mcpRuntime.atom';
import { useToast } from '../ui/ToastProvider';
import SettingsLayout from '../settings/SettingsLayout';
import McpContentView from './McpContentView';
import { McpOps } from '../../lib/mcp/mcpOps';
import { AgentContextType } from '../../types/agentContextTypes';

const McpView: React.FC = () => {
  const navigate = useNavigate();
  const {
    onMcpServerMenuToggle,
    mcpServerMenuState,
    onMcpServerConnect,
    onMcpServerDisconnect,
    onMcpServerReconnect,
    onMcpServerDelete,
    onMcpServerEdit,
    onMcpAddMenuToggle,
  } = useOutletContext<AgentContextType>();

  // MCP runtime servers + stats（runtime state 来自 mcpClientCacheManager）
  const servers = useMcpRuntimeServers();
  const mcpStats = useMcpRuntimeStats();
  const refreshRuntimeInfo = refreshMcpRuntime;
  const isLoading = false;

  const { showError } = useToast();

  const totalServers = mcpStats.totalServers;
  const connectedServers = mcpStats.connectedServers;
  const totalTools = mcpStats.totalTools;

  // Local state management
  const [operationStates, setOperationStates] = useState<
    Record<
      string,
      {
        isOperating: boolean;
        operation?: 'connect' | 'disconnect' | 'reconnect';
      }
    >
  >({});

  // Helper function for server operations - using McpOps API
  const performServerOperation = useCallback(
    async (
      serverName: string,
      action: 'connect' | 'disconnect' | 'reconnect',
    ) => {
      // Set operation state
      setOperationStates((prev) => ({
        ...prev,
        [serverName]: { isOperating: true, operation: action },
      }));

      try {
        let result: { success: boolean; error?: string };

        // Call appropriate McpOps method based on action
        switch (action) {
          case 'connect':
            result = await McpOps.connect(serverName);
            break;
          case 'disconnect':
            result = await McpOps.disconnect(serverName);
            break;
          case 'reconnect':
            result = await McpOps.reconnect(serverName);
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }

        if (!result.success) {
          throw new Error(result.error || `Failed to ${action} server`);
        }

        // Refresh global state and clear operation state after a delay
        // 🔧 Fix: delay clearing operation state to allow enough time for backend state updates to propagate to the frontend
        setTimeout(() => {
          refreshRuntimeInfo().catch(() => {});
          // Clear operation state to show the server's actual status
          setOperationStates((prev) => {
            const newStates = { ...prev };
            delete newStates[serverName];
            return newStates;
          });
        }, 500); // Increase delay to ensure backend state update has time to propagate
      } catch (error) {
        // Clear operation state immediately on error
        setOperationStates((prev) => {
          const newStates = { ...prev };
          delete newStates[serverName];
          return newStates;
        });
        throw error;
      }
    },
    [refreshRuntimeInfo],
  );

  // Server operation handlers - use externally passed handlers if available; otherwise use local ones
  const handleConnectServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerConnect) {
        onMcpServerConnect(serverName);
        return;
      }

      try {
        await performServerOperation(serverName, 'connect');
      } catch (error) {
        showError(
          `Failed to connect server: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [performServerOperation, showError, servers, onMcpServerConnect],
  );

  const handleDisconnectServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerDisconnect) {
        onMcpServerDisconnect(serverName);
        return;
      }

      try {
        await performServerOperation(serverName, 'disconnect');
      } catch (error) {
        showError(
          `Failed to disconnect server: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [performServerOperation, showError, servers, onMcpServerDisconnect],
  );

  const handleReconnectServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerReconnect) {
        onMcpServerReconnect(serverName);
        return;
      }

      try {
        await performServerOperation(serverName, 'reconnect');
      } catch (error) {
        showError(
          `Failed to reconnect server: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [performServerOperation, showError, servers, onMcpServerReconnect],
  );

  const handleDeleteServer = useCallback(
    (serverName: string) => {
    // If an external handler is provided, use it (shows a confirmation dialog)
      if (onMcpServerDelete) {
        onMcpServerDelete(serverName);
        return;
      }

      // Local handling (no longer uses window.confirm, deletes directly)
      // Note: when used in SettingsPage, the confirmation dialog is shown via the onMcpServerDelete callback
      // This local handler is a fallback and in practice will not be called
      (async () => {
        try {
          // Use McpOps API to delete server
          const result = await McpOps.delete(serverName);

          if (!result.success) {
            throw new Error(result.error || 'Failed to delete server');
          }

          // mcpClientManager will notify ProfileDataManager automatically via IPC
          // No need for manual cache updates here
        } catch (error) {
          showError(
            `Failed to delete server: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })();
    },
    [showError, servers, onMcpServerDelete],
  );

  const handleEditServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerEdit) {
        onMcpServerEdit(serverName);
        return;
      }

      // Navigate to edit page
      navigate(`/settings/mcp/edit/${encodeURIComponent(serverName)}`);
    },
    [navigate, onMcpServerEdit],
  );

  // Handle server added callback
  const handleServerAdded = useCallback(() => {
    // Refresh global state to reflect newly added/updated server
    setTimeout(async () => {
      try {
        await refreshRuntimeInfo();
      } catch (error) {}
    }, 500); // Slightly extend wait time to ensure server initialization is complete
  }, [refreshRuntimeInfo]);

  return (
    <SettingsLayout
      icon={<Cable size={18} />}
      title="MCP Connector"
      badges={
        <>
          <Badge variant="secondary" className="text-xs">total servers: {totalServers}</Badge>
          <Badge variant="secondary" className="text-xs">connected: {connectedServers}</Badge>
          <Badge variant="secondary" className="text-xs">available tools: {totalTools}</Badge>
        </>
      }
      actions={
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => (onMcpAddMenuToggle || (() => {}))(e.currentTarget)}
          title="Add MCP Server"
        >
          <Plus size={16} />
        </Button>
      }
    >
      <McpContentView
        servers={servers}
        isLoading={isLoading}
        operationStates={operationStates}
        onConnect={onMcpServerConnect || handleConnectServer}
        onDisconnect={onMcpServerDisconnect || handleDisconnectServer}
        onReconnect={onMcpServerReconnect || handleReconnectServer}
        onDelete={onMcpServerDelete || handleDeleteServer}
        onEdit={onMcpServerEdit || handleEditServer}
        onMcpServerMenuToggle={onMcpServerMenuToggle}
        mcpServerMenuState={mcpServerMenuState}
      />
    </SettingsLayout>
  );
};


export default McpView
