import React from 'react';
import { Pencil, Play, Pause, RotateCw, Trash2, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';
import { Button } from '@/shadcn/button';
import type { MCPServerStatus } from '@/lib/mcp/mcpClientCacheManager';
import type { McpServerOperationState } from './useMcpServerActions';

interface McpServerDropdownMenuProps {
  serverName: string;
  status: MCPServerStatus;
  operationState?: McpServerOperationState;
  onConnect: (serverName: string) => void;
  onDisconnect: (serverName: string) => void;
  onReconnect: (serverName: string) => void;
  onDelete: (serverName: string) => void;
  onEdit: (serverName: string) => void;
}

function getAvailableActions(status: MCPServerStatus) {
  switch (status) {
    case 'disconnected':
      return { connect: true, disconnect: false, reconnect: false };
    case 'connected':
      return { connect: false, disconnect: true, reconnect: false };
    case 'error':
      return { connect: false, disconnect: true, reconnect: true };
    case 'connecting':
    case 'disconnecting':
      return { connect: false, disconnect: false, reconnect: false };
    default:
      return { connect: true, disconnect: false, reconnect: false };
  }
}

const McpServerDropdownMenu: React.FC<McpServerDropdownMenuProps> = ({
  serverName,
  status,
  operationState,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
}) => {
  const isTransitioning =
    operationState?.isOperating || status === 'connecting' || status === 'disconnecting';
  const availableActions = getAvailableActions(status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          title="More options"
          aria-label={`Actions for ${serverName}`}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {availableActions.connect && (
          <DropdownMenuItem onSelect={() => onConnect(serverName)}>
            <Play size={16} strokeWidth={1.5} />
            <span>Connect</span>
          </DropdownMenuItem>
        )}
        {availableActions.disconnect && (
          <DropdownMenuItem onSelect={() => onDisconnect(serverName)}>
            <Pause size={16} strokeWidth={1.5} />
            <span>Disconnect</span>
          </DropdownMenuItem>
        )}
        {availableActions.reconnect && (
          <DropdownMenuItem onSelect={() => onReconnect(serverName)}>
            <RotateCw size={16} strokeWidth={1.5} />
            <span>Reconnect</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={isTransitioning} onSelect={() => onEdit(serverName)}>
          <Pencil size={16} strokeWidth={1.5} />
          <span>Edit</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-red-600 focus:text-red-600"
          onSelect={() => onDelete(serverName)}
        >
          <Trash2 size={16} strokeWidth={1.5} />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default McpServerDropdownMenu;
