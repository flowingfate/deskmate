import React from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,

  Settings,
} from 'lucide-react';
import { Checkbox } from '@/shadcn/checkbox';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import { cn } from '@/lib/utilities/utils';
import StatusBadge from '../../mcp/StatusBadge';

import type { MCPServerExtended } from '../../../lib/mcp/mcpClientCacheManager';

interface AgentMcpServerCardProps {
  server: MCPServerExtended;
  selectedTools: Set<string> | undefined;
  isSelected: boolean;
  isExpanded: boolean;
  readOnly: boolean;
  currentState: string;
  hasConflicts: boolean;
  isToolConflicted: (toolName: string) => boolean;
  getConflictTooltip: (toolName: string) => string;
  conflictPeers: (toolName: string) => string[];
  onServerToggle: (serverName: string, serverTools: { name: string }[]) => void;
  onToolToggle: (
    serverName: string,
    toolName: string,
    serverTools: { name: string }[],
  ) => void;
  onServerExpand: (serverName: string) => void;
  onManageServers: () => void;
}

/**
 * 单条 MCP server card + 嵌套 tool 列表(Agent editor `mcp_servers` tab 用)。
 *
 * 全部状态由父注入(`AgentMcpServersTab` 持中央 selection map)。
 * 视觉与 `/settings/mcp` 一致 —— 全 Tailwind + semantic tokens + 共享
 * `StatusBadge`,不再依赖 `ServerCard.scss` 任何选择器。
 */
const AgentMcpServerCard: React.FC<AgentMcpServerCardProps> = ({
  server,
  selectedTools,
  isSelected,
  isExpanded,
  readOnly,
  currentState,
  hasConflicts,
  isToolConflicted,
  getConflictTooltip,
  conflictPeers,
  onServerToggle,
  onToolToggle,
  onServerExpand,
  onManageServers,
}) => {
  const serverTools = server.tools || [];
  const hasError = !!server.error;
  const isDisabled = readOnly || currentState !== 'connected';

  const isFullySelected = (() => {
    if (!selectedTools) return false;
    if (selectedTools.size === 0) return true;
    return serverTools.every((tool) => selectedTools.has(tool.name));
  })();

  const isPartiallySelected = (() => {
    if (!selectedTools) return false;
    if (selectedTools.size === 0) return false;
    return selectedTools.size > 0 && selectedTools.size < serverTools.length;
  })();

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border border-sc-border bg-sc-card p-3 transition-colors',
        isSelected && !hasConflicts && 'border-sc-ring/40 bg-sc-accent/40',
        hasConflicts && 'border-red-300 bg-red-50/40 dark:border-red-500/30 dark:bg-red-500/5',
      )}
      title={hasConflicts ? '⚠️ This server contains conflicting tool names' : undefined}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isPartiallySelected ? 'indeterminate' : isSelected}
          onCheckedChange={() => {
            if (!isDisabled) onServerToggle(server.name, serverTools);
          }}
          onClick={(e) => e.stopPropagation()}
          disabled={isDisabled}
          className="mt-0.5"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h4 className="min-w-0 truncate text-sm font-semibold text-sc-foreground">
              {server.name}
            </h4>
            {hasConflicts && (
              <Badge variant="destructive" className="text-[10px] font-medium uppercase">
                Conflict
              </Badge>
            )}
            {hasError && (
              <AlertTriangle
                className="size-3.5 shrink-0 text-red-500"
                aria-label={server.error || 'Connection error'}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={currentState} />
            {currentState === 'connected' && (
              <span className="text-xs text-sc-muted-foreground">
                {isSelected && selectedTools
                  ? `${selectedTools.size === 0 ? serverTools.length : selectedTools.size}/${serverTools.length} tools`
                  : `${serverTools.length} tool${serverTools.length === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              onManageServers();
            }}
            title="Manage MCP Servers"
            aria-label="Manage MCP Servers"
          >
            <Settings className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              if (currentState === 'connected' && serverTools.length > 0) {
                onServerExpand(server.name);
              }
            }}
            disabled={currentState !== 'connected' || serverTools.length === 0}
            aria-label={isExpanded ? 'Collapse tools' : 'Expand tools'}
            title={isExpanded ? 'Collapse tools' : 'Expand tools'}
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Expanded tool list */}
      {isExpanded && serverTools.length > 0 && (
        <ul className="ml-7 flex flex-col gap-1 border-l border-sc-border pl-3">
          {serverTools.map((tool) => {
            const isSelectedTool = selectedTools
              ? selectedTools.size === 0 || selectedTools.has(tool.name)
              : false;
            const conflicted = isToolConflicted(tool.name);
            const tooltip = conflicted ? getConflictTooltip(tool.name) : '';
            return (
              <li key={tool.name}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors',
                    'hover:bg-sc-accent/50',
                    conflicted && 'bg-red-50/30 hover:bg-red-50/60 dark:bg-red-500/5 dark:hover:bg-red-500/10',
                  )}
                  title={conflicted ? tooltip : tool.description || ''}
                >
                  <Checkbox
                    checked={isSelectedTool}
                    onCheckedChange={() => {
                      if (currentState === 'connected') {
                        onToolToggle(server.name, tool.name, serverTools);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={readOnly || currentState !== 'connected'}
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate text-sm font-medium text-sc-foreground">
                        {tool.name}
                      </span>
                      {conflicted && (
                        <Badge variant="destructive" className="text-[10px]">
                          conflict
                        </Badge>
                      )}
                    </div>
                    {tool.description && (
                      <span className="text-xs leading-relaxed text-sc-muted-foreground">
                        {tool.description}
                      </span>
                    )}
                    {conflicted && (
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">
                        Also appears in: {conflictPeers(tool.name).join(', ')}
                      </span>
                    )}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AgentMcpServerCard;
