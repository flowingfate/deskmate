'use client';

import React from 'react';
import { AlertTriangle, MoreHorizontal } from 'lucide-react';
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import StatusBadge from './StatusBadge';

interface ServerCardProps {
  serverName: string;
  operationState?: {
    isOperating: boolean;
    operation?: 'connect' | 'disconnect' | 'reconnect';
  };
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onMenuToggle?: (event: React.MouseEvent) => void;
  isMenuOpen?: boolean;
  isSelected?: boolean;
}

/**
 * 单条 MCP server 概览(列表项)。
 *
 * 状态判定逻辑沿用原 ServerCard:operationState > raw server.status 优先级。
 * 视觉全 Tailwind + semantic tokens + 共享 StatusBadge;不再依赖
 * `ServerCard.scss` 任何选择器。
 *
 * 注:从父 `McpServerListView` 已经渲染了选中边框与背景,因此本组件不重复
 * 渲染 wrapper —— 仅渲染卡片内容。`isSelected` 仅用于读但目前不直接影响样式。
 */
const ServerCard: React.FC<ServerCardProps> = ({
  serverName,
  operationState,
  onMenuToggle,
  isMenuOpen = false,
}) => {
  const servers = useMcpRuntimeServers();
  const server = servers.find((s) => s.name === serverName);
  if (!server) return null;

  const isOperating = operationState?.isOperating || false;
  const currentOperation = operationState?.operation;
  const serverTools = server.tools || [];
  const hasError = !!server.error;
  const error = server.error;

  // 状态判定 - operation state 最高优先级
  const currentState = (() => {
    if (isOperating) {
      if (currentOperation === 'connect') return 'connecting';
      if (currentOperation === 'disconnect') return 'disconnecting';
      if (currentOperation === 'reconnect') return 'connecting';
    }
    if (server.status === 'connecting') return 'connecting';
    if (server.status === 'disconnecting') return 'disconnecting';
    if (server.status === 'needs-user-interaction') return 'needs-user-interaction';
    if (server.status === 'connected' && serverTools.length > 0) return 'connected';
    if (server.status === 'error') return 'error';
    if (server.status !== 'connected' && hasError) return 'error';
    return server.status || 'disconnected';
  })();

  const showErrorIcon =
    hasError &&
    (currentState === 'error' || currentState === 'needs-user-interaction');

  return (
    <div className="flex w-full items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-sc-foreground">
            {serverName}
          </h4>
          {showErrorIcon && (
            <AlertTriangle
              className="size-3.5 shrink-0 text-red-500"
              aria-label={error || 'Connection error'}
            />
          )}
        </div>

        {server.version && (
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" className="text-[10px]">
              v{server.version}
            </Badge>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <StatusBadge status={currentState} />
          {currentState === 'connected' && (
            <span className="text-xs text-sc-muted-foreground">
              {serverTools.length} tool{serverTools.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {onMenuToggle && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onMenuToggle}
          title="More options"
          aria-label={`Actions for ${serverName}`}
          className={isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      )}
    </div>
  );
};

export default ServerCard;
