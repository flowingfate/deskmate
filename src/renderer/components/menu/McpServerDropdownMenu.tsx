import React from 'react';
import { Pencil, Play, Pause, RotateCw, Trash2 } from 'lucide-react';
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shadcn/dropdown-menu';

interface McpServerDropdownMenuProps {
  serverName: string;
  anchorElement: HTMLElement;
  onConnect?: (serverName: string) => void;
  onDisconnect?: (serverName: string) => void;
  onReconnect?: (serverName: string) => void;
  onDelete?: (serverName: string) => void;
  onEdit?: (serverName: string) => void;
  onClose: () => void;
}

const McpServerDropdownMenu: React.FC<McpServerDropdownMenuProps> = ({
  serverName,
  anchorElement,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
  onClose,
}) => {
  const mcpServers = useMcpRuntimeServers();

  const currentServer = mcpServers.find((s: any) => s.name === serverName);


  const mcpOps = (window as any).__mcpServerOperations;
  const finalOnConnect = onConnect || mcpOps?.onConnect;
  const finalOnDisconnect = onDisconnect || mcpOps?.onDisconnect;
  const finalOnReconnect = onReconnect || mcpOps?.onReconnect;
  const finalOnDelete = onDelete || mcpOps?.onDelete;
  const finalOnEdit = onEdit || mcpOps?.onEdit;

  const anchorRect = anchorElement.getBoundingClientRect();

  const getAvailableActions = () => {
    if (!currentServer) return { connect: true, disconnect: false, reconnect: false };

    const status = currentServer.status || 'disconnected';

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
  };

  const availableActions = getAvailableActions();

  const hasAnyAction = finalOnConnect || finalOnDisconnect || finalOnReconnect || finalOnEdit || finalOnDelete;

  const isTransitioning = currentServer?.status === 'connecting' || currentServer?.status === 'disconnecting';

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: 'fixed',
            top: anchorRect.bottom,
            left: anchorRect.left,
            width: anchorRect.width,
            height: 0,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        {!hasAnyAction && (
          <DropdownMenuItem disabled>
            <span>No actions available</span>
          </DropdownMenuItem>
        )}
        {availableActions.connect && finalOnConnect && (
          <DropdownMenuItem onClick={() => finalOnConnect(serverName)}>
            <Play size={16} strokeWidth={1.5} />
            <span>Connect</span>
          </DropdownMenuItem>
        )}
        {availableActions.disconnect && finalOnDisconnect && (
          <DropdownMenuItem onClick={() => finalOnDisconnect(serverName)}>
            <Pause size={16} strokeWidth={1.5} />
            <span>Disconnect</span>
          </DropdownMenuItem>
        )}
        {availableActions.reconnect && finalOnReconnect && (
          <DropdownMenuItem onClick={() => finalOnReconnect(serverName)}>
            <RotateCw size={16} strokeWidth={1.5} />
            <span>Reconnect</span>
          </DropdownMenuItem>
        )}
        {finalOnEdit && (
          <DropdownMenuItem
            disabled={isTransitioning}
            onClick={() => {
              if (!isTransitioning) finalOnEdit(serverName);
            }}
          >
            <Pencil size={16} strokeWidth={1.5} />
            <span>Edit</span>
          </DropdownMenuItem>
        )}
        {finalOnDelete && (
          <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => finalOnDelete(serverName)}>
            <Trash2 size={16} strokeWidth={1.5} />
            <span>Delete</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default McpServerDropdownMenu;