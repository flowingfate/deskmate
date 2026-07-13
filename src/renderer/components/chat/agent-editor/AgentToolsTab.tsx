import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, ExternalLink } from 'lucide-react';
import { Checkbox } from '@/shadcn/checkbox';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import { ScrollArea } from '@/shadcn/scroll-area';
import { Separator } from '@/shadcn/separator';

import { TabComponentProps } from './types';
import { useLocalTools, useLocalToolsLoading } from '@/states/tools.atom';
import ListSearchBox from '../../ui/ListSearchBox';
import { useDirtyTracker, setEquals, setFingerprint } from './useDirtyTracker';

/**
 * AgentToolsTab - Agent 本地工具白名单 tab(deskmate 原生 tools)。
 *
 * 与 `AgentMcpServersTab` 平级、独立 —— MCP 只管外部 server,这里只管
 * `pi/tools/` 注册的本地工具。
 *
 * 数据语义(与 `AgentMarkdownFrontBase.tools` 一致):
 * - `tools` 缺席 / `[]`     ⇒ 全部启用本地工具(默认)
 * - `tools = ['x','y']`     ⇒ 仅启用列表内的工具
 *
 * UI 策略:
 * - hydrate 时,缺席/空 ⇒ 视为"全部勾选"(用户视角直观可见 = 全开)
 * - 取消勾选任意一项 ⇒ 自动进入"白名单"模式
 * - 勾选数 === 全部 ⇒ 存盘归一为 `[]`("全开"),避免每加新工具都要回来勾
 *
 * 视觉:全 Tailwind + shadcn 原语,与 `/settings/tools` 风格保持一致。
 */
const AgentToolsTab: React.FC<TabComponentProps> = ({
  agentData,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const allTools = useLocalTools();
  const isLoading = useLocalToolsLoading();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const ready = !!agentData?.id && allTools.length > 0;

  /** persist 形态(`undefined | string[]`)→ UI 内部 Set<toolName>。缺席/空 ⇒ 全选。 */
  const inflate = useCallback(
    (raw: string[] | undefined): Set<string> =>
      !raw || raw.length === 0 ? new Set(allTools.map((t) => t.name)) : new Set(raw),
    [allTools],
  );

  const baseline = useMemo(() => inflate(agentData?.tools), [inflate, agentData?.tools]);
  const cached = useMemo(
    () => (cachedData?.tools !== undefined ? inflate(cachedData.tools) : null),
    [inflate, cachedData?.tools],
  );

  const { value: selectedTools, setValue: setSelectedTools } = useDirtyTracker<Set<string>>({
    tabName: 'tools',
    ready,
    agentId: agentData?.id,
    baseline,
    cached,
    equals: setEquals,
    fingerprint: setFingerprint,
    // 勾选数 === 全部 ⇒ `[]`(等价"全开"),否则白名单。
    toPayload: (set) => ({
      tools: allTools.length > 0 && set.size === allTools.length ? [] : Array.from(set),
    }),
    onDataChange,
  });

  const handleToolToggle = useCallback(
    (toolName: string) => {
      if (readOnly) return;
      setSelectedTools((prev) => {
        const next = new Set(prev);
        if (next.has(toolName)) next.delete(toolName);
        else next.add(toolName);
        return next;
      });
    },
    [readOnly],
  );

  const handleSelectAll = useCallback(() => {
    if (readOnly) return;
    setSelectedTools(new Set(allTools.map((t) => t.name)));
  }, [readOnly, allTools]);

  const handleDeselectAll = useCallback(() => {
    if (readOnly) return;
    setSelectedTools(new Set());
  }, [readOnly]);

  const handleManageTools = useCallback(() => {
    navigate('/settings/tools');
  }, [navigate]);

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allTools;
    return allTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? '').toLowerCase().includes(q),
    );
  }, [allTools, searchQuery]);

  const totalSelected = selectedTools.size;
  const isAllSelected = totalSelected === allTools.length && allTools.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-black/7">
        <div className="flex items-center gap-2 text-sm text-sc-foreground">
          <span>
            <strong className="font-semibold">{totalSelected}</strong>
            <span className="text-sc-muted-foreground"> / {allTools.length} local tools selected</span>
          </span>
          {isAllSelected && (
            <Badge variant="secondary" className="text-xs">All enabled</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={readOnly || isAllSelected}
          >
            Select All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeselectAll}
            disabled={readOnly || totalSelected === 0}
          >
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleManageTools}
            title="Open local tools catalog"
          >
            <ExternalLink size={14} data-icon="inline-start" />
            View Catalog
          </Button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-sc-muted-foreground p-2">
          Loading tools...
        </div>
      ) : allTools.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sc-muted-foreground">
          <Wrench className="size-10 opacity-40" />
          <p className="text-sm font-medium">No Local Tools Available</p>
          <p className="text-xs">No tools are currently registered in the local catalog.</p>
        </div>
      ) : (
        <div className="p-2 gap-2 flex flex-1 flex-col min-h-0">
          <ListSearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search local tools..."
          />
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col gap-1.5">
              {filteredTools.map((tool) => {
                const isSelected = selectedTools.has(tool.name);
                return (
                  <li key={tool.name}>
                    <label
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-sc-border bg-sc-card px-3 py-2.5 text-sm transition-colors hover:bg-sc-accent/40"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToolToggle(tool.name)}
                        disabled={readOnly}
                        className="mt-0.5"
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium text-sc-foreground">
                          {tool.name}
                        </span>
                        {tool.description && (
                          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-sc-muted-foreground">
                            {tool.description}
                          </pre>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
};

export default AgentToolsTab;
