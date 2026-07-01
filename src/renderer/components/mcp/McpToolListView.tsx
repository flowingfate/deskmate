'use client';

import React from 'react';
import { Wrench, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utilities/utils';
import { MCPTool } from '../../types/mcpTypes';

interface McpToolListViewProps {
  tools: MCPTool[];
  onSelectTool: (tool: MCPTool) => void;
  isLoading?: boolean;
}

/**
 * MCP server 的 tool 列表(右栏 list view)。
 *
 * 与 `tools/ToolListView` 风格一致 —— 单独存在是因为 `MCPTool` 带 `serverId`
 * 用于稳定 key,且这里 click 切换"详情"视图(`ChevronRight` 表示可深入)。
 */
const McpToolListView: React.FC<McpToolListViewProps> = ({
  tools,
  onSelectTool,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-sm">Loading tools...</p>
      </div>
    );
  }

  if (tools.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
        <Wrench className="size-10 opacity-40" />
        <p className="text-sm">No tools available</p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3">
      {tools.map((tool) => {
        return (
          <li key={`${tool.serverId}-${tool.name}`}>
            <button
              type="button"
              onClick={() => onSelectTool(tool)}
              className={cn(
                'group flex h-full w-full items-start gap-3 rounded-xl border border-sc-border bg-sc-card p-4 text-left transition-colors',
                'hover:border-neutral-300 hover:bg-sc-accent/60 dark:hover:border-neutral-500/40',
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-50 text-neutral-500 transition-colors group-hover:bg-neutral-100 dark:bg-neutral-500/15 dark:text-neutral-400 dark:group-hover:bg-neutral-500/25">
                <Wrench size={16} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold text-sc-foreground transition-colors group-hover:text-neutral-500 dark:group-hover:text-neutral-400">{tool.name}</span>
                {tool.description && (
                  <span className="line-clamp-2 text-xs leading-relaxed text-sc-muted-foreground">
                    {tool.description}
                  </span>
                )}
              </span>
              <ChevronRight
                size={16}
                className="mt-1 shrink-0 text-sc-muted-foreground opacity-0 transition-opacity group-hover:opacity-60"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default McpToolListView;
