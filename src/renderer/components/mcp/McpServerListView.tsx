'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Cable, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utilities/utils';
import ServerCard from './McpServerCard';
import ListSearchBox from '../ui/ListSearchBox';
import { ScrollArea } from '@/shadcn/scroll-area';
import { MCPServerExtended } from '../../lib/userData/types';

interface McpServerListViewProps {
  servers: MCPServerExtended[];
  isLoading: boolean;
  operationStates: Record<
    string,
    {
      isOperating: boolean;
      operation?: 'connect' | 'disconnect' | 'reconnect';
    }
  >;
  onConnect: (serverName: string) => void;
  onDisconnect: (serverName: string) => void;
  onReconnect: (serverName: string) => void;
  onDelete: (serverName: string) => void;
  onEdit: (serverName: string) => void;
  selectedServer?: MCPServerExtended | null;
  onSelectServer?: (server: MCPServerExtended | null) => void;
  onMcpServerMenuToggle?: (serverName: string, buttonElement: HTMLElement) => void;
  mcpServerMenuState?: {
    isOpen: boolean;
    serverName: string | null;
    anchorElement: HTMLElement | null;
  };
  mcpServerOperations?: {
    onConnect: (serverName: string) => void;
    onDisconnect: (serverName: string) => void;
    onReconnect: (serverName: string) => void;
    onDelete: (serverName: string) => void;
    onEdit: (serverName: string) => void;
  };
}

/**
 * MCP server 列表(`/settings/mcp` 左栏)。
 *
 * 全 Tailwind + ScrollArea + 共享 `ServerCard`,无 scss 依赖。
 * 倒序展示(最新添加在最上),内置搜索,选中态由父透传 + 视觉反馈在
 * card 外层(`bg-sc-accent` + `border-sc-border`)。
 *
 * 选中维护:当过滤结果变更,自动选第一项;外部选中不在过滤集时清空搜索
 * 以暴露目标项(URL `?selectServer=` 跳转场景)。
 */
const McpServerListView: React.FC<McpServerListViewProps> = ({
  servers,
  isLoading,
  operationStates,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
  selectedServer,
  onSelectServer,
  onMcpServerMenuToggle,
  mcpServerMenuState,
  mcpServerOperations,
}) => {
  // 把 ops 挂 window —— AgentLayout 集中渲染 dropdown 时按需取
  React.useEffect(() => {
    if (mcpServerOperations) {
      (window as unknown as { __mcpServerOperations?: unknown }).__mcpServerOperations = mcpServerOperations;
    }
    return () => {
      delete (window as unknown as { __mcpServerOperations?: unknown }).__mcpServerOperations;
    };
  }, [mcpServerOperations]);

  const handleMenuToggle = (serverName: string) => (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onMcpServerMenuToggle) {
      onMcpServerMenuToggle(serverName, event.currentTarget as HTMLElement);
    }
  };

  const sortedServers = useMemo(() => servers.slice().reverse(), [servers]);

  const [searchQuery, setSearchQuery] = useState('');
  const filteredServers = searchQuery
    ? sortedServers.filter((s) => s.name?.includes(searchQuery))
    : sortedServers;

  const filteredIdentity = useMemo(
    () => filteredServers.map((s) => s.name ?? '').join('\0'),
    [filteredServers],
  );

  // 选中态与过滤结果同步:过滤变空时清空或还原搜索;外部选中不在过滤集时,
  // 若搜索把它挡住了就清搜索,否则回退到首项。
  useEffect(() => {
    if (filteredServers.length === 0) {
      if (selectedServer) {
        if (searchQuery && sortedServers.some((s) => s.name === selectedServer.name)) {
          setSearchQuery('');
          return;
        }
        onSelectServer?.(null);
      }
      return;
    }
    if (!selectedServer) {
      onSelectServer?.(filteredServers[0]);
      return;
    }
    const inFiltered = filteredServers.some((s) => s.name === selectedServer.name);
    if (!inFiltered) {
      if (searchQuery && sortedServers.some((s) => s.name === selectedServer.name)) {
        setSearchQuery('');
        return;
      }
      onSelectServer?.(filteredServers[0]);
    }
  }, [searchQuery, filteredIdentity, selectedServer?.name]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Loading servers...</p>
      </div>
    );
  }

  if (!servers || servers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sc-muted-foreground">
        <Cable className="size-10 opacity-40" />
        <p className="text-sm font-medium">No MCP servers configured</p>
        <p className="text-xs">Click the + button above to add a server.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ListSearchBox
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search MCP servers..."
      />
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-1.5">
          {filteredServers.map((server, index) => {
            const isSelected = selectedServer?.name === server.name;
            const serverName = server.name || `Server ${index + 1}`;
            const isMenuOpen =
              mcpServerMenuState?.isOpen && mcpServerMenuState?.serverName === serverName;
            return (
              <li key={server.name || index}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectServer?.(server)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectServer?.(server);
                    }
                  }}
                  className={cn(
                    'group flex w-full cursor-pointer items-start gap-3 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors',
                    'hover:bg-sc-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring',
                    isSelected && 'border-sc-border bg-sc-accent text-sc-accent-foreground',
                  )}
                >
                  <ServerCard
                    serverName={serverName}
                    operationState={operationStates[serverName]}
                    onConnect={() => onConnect(serverName)}
                    onDisconnect={() => onDisconnect(serverName)}
                    onReconnect={() => onReconnect(serverName)}
                    onDelete={() => onDelete(serverName)}
                    onEdit={() => onEdit(serverName)}
                    onMenuToggle={handleMenuToggle(serverName)}
                    isMenuOpen={isMenuOpen}
                    isSelected={isSelected}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
};

export default McpServerListView;
