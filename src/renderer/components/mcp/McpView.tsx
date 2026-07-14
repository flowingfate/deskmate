'use client'

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Cable, Plus } from 'lucide-react';
import { Badge } from '@/shadcn/badge';
import { Button } from '@/shadcn/button';
import {
  useMcpRuntimeServers,
  useMcpRuntimeStats,
} from '@/states/mcpRuntime.atom';
import SettingsLayout from '../settings/SettingsLayout';
import DeleteMcpServerConfirmDialog from './DeleteMcpServerConfirmDialog';
import McpContentView from './McpContentView';
import { useMcpServerActions } from './useMcpServerActions';

const McpView: React.FC = () => {
  const navigate = useNavigate();
  const servers = useMcpRuntimeServers();
  const { totalServers, connectedServers, totalTools } = useMcpRuntimeStats();
  const actions = useMcpServerActions();

  return (
    <>
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
            size="icon-sm"
            onClick={() => navigate('/settings/mcp/new')}
            title="Add MCP Server"
          >
            <Plus size={14} />
          </Button>
        }
      >
        <McpContentView
          servers={servers}
          isLoading={false}
          operationStates={actions.operationStates}
          onConnect={actions.connect}
          onDisconnect={actions.disconnect}
          onReconnect={actions.reconnect}
          onDelete={actions.requestDelete}
          onEdit={actions.edit}
        />
      </SettingsLayout>
      <DeleteMcpServerConfirmDialog
        open={actions.deleteDialog.open}
        serverName={actions.deleteDialog.serverName}
        onClose={actions.closeDelete}
        onConfirm={actions.confirmDelete}
      />
    </>
  );
};


export default McpView
