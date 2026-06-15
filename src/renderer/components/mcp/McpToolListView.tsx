'use client';

import React from 'react';
import { Wrench, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utilities/utils';
import { MCPTool } from '../../types/mcpTypes';

interface McpToolListViewProps {
  tools: MCPTool[];
  selectedTool: MCPTool | null;
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
  selectedTool,
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
    <ul className="flex flex-col gap-1.5">
      {tools.map((tool) => {
        const isSelected = selectedTool?.name === tool.name;
        return (
          <li key={`${tool.serverId}-${tool.name}`}>
            <button
              type="button"
              onClick={() => onSelectTool(tool)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-sc-accent hover:text-sc-accent-foreground',
                isSelected && 'border-sc-border bg-sc-accent text-sc-accent-foreground',
              )}
            >
              <Wrench className="size-4 shrink-0 text-sc-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{tool.name}</span>
              <ChevronRight className="size-4 shrink-0 text-sc-muted-foreground opacity-60" />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default McpToolListView;
