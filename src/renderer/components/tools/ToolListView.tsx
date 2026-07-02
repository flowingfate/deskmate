'use client';

import React from 'react';
import { Wrench, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utilities/utils';
import type { LocalToolInfo } from '@shared/types/toolsTypes';

interface ToolListViewProps {
  tools: LocalToolInfo[];
  selectedTool: LocalToolInfo | null;
  onSelectTool: (tool: LocalToolInfo) => void;
  isLoading?: boolean;
}

/**
 * 纯展示组件:渲染 LocalToolInfo 列表。
 *
 * 行为与 SkillListPanel 相似但消费 `LocalToolInfo`,不依赖 MCP runtime;
 * 全 Tailwind + semantic tokens(`bg-sc-accent` / `text-sc-muted-foreground`
 * 等),无独立 scss。`/settings/tools` 与 agent editor tools tab 都用它。
 */
const ToolListView: React.FC<ToolListViewProps> = ({
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
          <li key={tool.name}>
            <button
              type="button"
              onClick={() => onSelectTool(tool)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-sc-accent hover:text-sc-accent-foreground',
                isSelected && 'border-sc-border bg-sc-accent text-sc-accent-foreground',
              )}
            >
              <Wrench
                className={cn(
                  'mt-0.5 size-4 shrink-0 transition-colors',
                  isSelected
                    ? 'text-neutral-500 dark:text-neutral-400'
                    : 'text-sc-muted-foreground',
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    'truncate font-medium',
                    isSelected && 'text-neutral-500 dark:text-neutral-400',
                  )}
                >
                  {tool.name}
                </span>
                {tool.description && (
                  <pre className="overflow-hidden truncate font-sans text-xs text-sc-muted-foreground">
                    {tool.description.split('\n')[0]}
                  </pre>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default ToolListView;
