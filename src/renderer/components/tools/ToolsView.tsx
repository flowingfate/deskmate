'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Wrench } from 'lucide-react';
import { Badge } from '@/shadcn/badge';
import { Card } from '@/shadcn/card';
import { ScrollArea } from '@/shadcn/scroll-area';

import SettingsLayout from '../settings/SettingsLayout';
import ToolListView from './ToolListView';
import ToolDetailView from './ToolDetailView';
import ListSearchBox from '../ui/ListSearchBox';
import { useLocalTools, useLocalToolsLoading } from '@/states/tools.atom';
import type { LocalToolInfo } from '@shared/types/toolsTypes';

/**
 * `/settings/tools` 全局视图:展示 deskmate 原生本地工具清单。
 *
 * 与 `/settings/mcp` 平级 —— MCP 只管外部 server,Tools 只管本地 registry。
 * 全 Tailwind + shadcn 原语(`Card` / `ScrollArea` / `Badge` / `ListSearchBox`),
 * 风格与现有 settings 页一致。
 */
const ToolsView: React.FC = () => {
  const tools = useLocalTools();
  const isLoading = useLocalToolsLoading();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        (tool.description ?? '').toLowerCase().includes(q),
    );
  }, [tools, searchQuery]);

  // 首次加载后(或选中项被过滤掉时)自动选中第一条。
  useEffect(() => {
    if (filteredTools.length === 0) {
      if (selectedToolName !== null) setSelectedToolName(null);
      return;
    }
    if (!selectedToolName || !filteredTools.find((t) => t.name === selectedToolName)) {
      setSelectedToolName(filteredTools[0].name);
    }
  }, [filteredTools, selectedToolName]);

  const selectedTool: LocalToolInfo | null = useMemo(
    () => filteredTools.find((t) => t.name === selectedToolName) ?? null,
    [filteredTools, selectedToolName],
  );

  return (
    <SettingsLayout
      icon={<Wrench size={18} />}
      title="Tools"
      badges={
        <Badge variant="secondary" className="text-xs">
          available tools: {tools.length}
        </Badge>
      }
    >
      <div className="flex h-full min-h-0 gap-3 p-3">
        <Card className="flex w-80 shrink-0 flex-col gap-2 overflow-hidden p-3">
          <ListSearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search local tools..."
          />
          <ScrollArea className="min-h-0 flex-1">
            <ToolListView
              tools={filteredTools}
              selectedTool={selectedTool}
              onSelectTool={(t) => setSelectedToolName(t.name)}
              isLoading={isLoading}
            />
          </ScrollArea>
        </Card>

        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
          <ToolDetailView tool={selectedTool} />
        </Card>
      </div>
    </SettingsLayout>
  );
};

export default ToolsView;
