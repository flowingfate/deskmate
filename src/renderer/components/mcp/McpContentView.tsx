'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import McpServerListView from './McpServerListView';
import McpToolListView from './McpToolListView';
import McpToolDetailView from './McpToolDetailView';
import { Card } from '@/shadcn/card';
import { ScrollArea } from '@/shadcn/scroll-area';
import { MCPServerExtended } from '../../lib/userData/types';
import { MCPTool } from '../../types/mcpTypes';

interface McpContentViewProps {
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
  onMcpServerMenuToggle?: (serverName: string, buttonElement: HTMLElement) => void;
  mcpServerMenuState?: {
    isOpen: boolean;
    serverName: string | null;
    anchorElement: HTMLElement | null;
  };
}

/**
 * `/settings/mcp` 主体:双 Card 布局(左 server list,右 tool list/detail)。
 *
 * 风格与 `/settings/tools`(`ToolsView`)对齐 —— 全 Tailwind + shadcn `Card` +
 * `ScrollArea`,无独立 scss。
 *
 * 内部状态:
 * - selectedServer:当前选中的 MCP server(URL `?selectServer=` 入口可设)。
 * - selectedTool / viewMode:右栏在"工具列表"与"工具详情"间切换。
 * - 当 servers 变更时自动选回第一项,选中项被删除 → 自动选首项;list 空时清空。
 */
const McpContentView: React.FC<McpContentViewProps> = ({
  servers,
  isLoading,
  operationStates,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
  onMcpServerMenuToggle,
  mcpServerMenuState,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectServerFromUrl = searchParams.get('selectServer');

  const [selectedServer, setSelectedServer] = useState<MCPServerExtended | null>(null);
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');

  // URL `?selectServer=` 触发一次自动选中
  useEffect(() => {
    if (selectServerFromUrl && servers.length > 0) {
      const target = servers.find((s) => s.name === selectServerFromUrl);
      if (target) {
        setSelectedServer(target);
        setSearchParams(
          (prev) => {
            prev.delete('selectServer');
            return prev;
          },
          { replace: true },
        );
      }
    }
  }, [selectServerFromUrl, servers, setSearchParams]);

  // servers 列表更新:若未选 / 选中已删,自动选第一项(空则清空)
  useEffect(() => {
    if (!selectedServer || !servers.find((s) => s.name === selectedServer.name)) {
      setSelectedServer(servers[0] ?? null);
    }
  }, [servers, selectedServer]);

  const selectedServerTools = useMemo(
    () => selectedServer?.tools || [],
    [selectedServer],
  );

  // selected server 变化 → 工具列首项;无则清空
  useEffect(() => {
    setSelectedTool(selectedServerTools[0] ?? null);
  }, [selectedServerTools]);

  const handleServerSelect = useCallback((server: MCPServerExtended | null) => {
    setSelectedServer(server);
    setViewMode('list');
  }, []);

  const handleToolSelect = useCallback((tool: MCPTool) => {
    setSelectedTool(tool);
    setViewMode('detail');
  }, []);

  const handleBackToList = useCallback(() => {
    setViewMode('list');
  }, []);

  return (
    <div className="flex h-full">
      <div className="p-3 w-65 border-r border-black/7">
        <McpServerListView
          servers={servers}
          isLoading={isLoading}
          operationStates={operationStates}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onReconnect={onReconnect}
          onDelete={onDelete}
          onEdit={onEdit}
          selectedServer={selectedServer}
          onSelectServer={handleServerSelect}
          onMcpServerMenuToggle={onMcpServerMenuToggle}
          mcpServerMenuState={mcpServerMenuState}
          mcpServerOperations={{
            onConnect,
            onDisconnect,
            onReconnect,
            onDelete,
            onEdit,
          }}
        />
      </div>

      <div className="flex flex-1 p-3">
        {viewMode === 'list' ? (
          <ScrollArea className="min-h-0 flex-1">
            <McpToolListView
              tools={selectedServerTools}
              onSelectTool={handleToolSelect}
              isLoading={isLoading && !selectedServer}
            />
          </ScrollArea>
        ) : (
          <McpToolDetailView
            tool={selectedTool}
            serverName={selectedServer?.name}
            onBack={handleBackToList}
          />
        )}
      </div>
    </div>
  );
};

export default McpContentView;
