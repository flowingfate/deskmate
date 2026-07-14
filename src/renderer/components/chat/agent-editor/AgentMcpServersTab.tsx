import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cable, Loader2 } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Separator } from '@/shadcn/separator';
import { ScrollArea } from '@/shadcn/scroll-area';

import { TabComponentProps, AgentMcpServer } from './types';
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom';
import { useToast } from '../../ui/ToastProvider';
import ListSearchBox from '../../ui/ListSearchBox';
import {
  detectGlobalConflicts,
  isToolConflicted,
  sourceHasConflicts,
  getConflictTooltip,
  checkToolConflict,
  type SelectionsMap,
} from './toolConflictHelper';
import AgentMcpServerCard from './AgentMcpServerCard';
import { useDirtyTracker, setEquals } from './useDirtyTracker';

/**
 * AgentMcpServersTab — Agent 关联的**外部 MCP server** 选择 tab。
 *
 * 本地工具(deskmate 原生)走独立的 `AgentToolsTab`,不在此 tab 内。
 *
 * 数据语义:
 * - `mcpServers` 缺席 / `[]`  ⇒ 不启用任何外部 MCP(默认)
 * - `mcpServers = [{name, tools: [...]}, ...]` ⇒ 仅启用列表内的 server,每条
 *   server 内 `tools: []` 表示"该 server 的全部工具",非空数组为白名单。
 *
 * 全局冲突算子已抽到 `toolConflictHelper.ts`,这里只组合 UI。
 */
const AgentMcpServersTab: React.FC<TabComponentProps> = ({
  agentData,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const servers = useMcpRuntimeServers();
  const isLoading = false;
  const navigate = useNavigate();
  const { showToast } = useToast();

  // 选中状态:serverName → 已勾工具名集合。空 Set ⇒ "全选该 server"。
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // 把 AgentMcpServer[] hydrate 成 Map<server, Set<tool>>。
  const hydrate = useCallback((list: AgentMcpServer[] | undefined): Map<string, Set<string>> => {
    const result = new Map<string, Set<string>>();
    if (!list) return result;
    list.forEach((server) => {
      const toolSet =
        server.tools && server.tools.length > 0
          ? new Set(server.tools)
          : new Set<string>();
      result.set(server.name, toolSet);
    });
    return result;
  }, []);

  const baseline = useMemo(() => hydrate(agentData?.mcpServers), [hydrate, agentData?.mcpServers]);
  const cached = useMemo(
    () => (cachedData?.mcpServers !== undefined ? hydrate(cachedData.mcpServers) : null),
    [hydrate, cachedData?.mcpServers],
  );

  const { value: serverSelections, setValue: setServerSelections } = useDirtyTracker<Map<string, Set<string>>>({
    tabName: 'mcp',
    ready: !!agentData?.id,
    agentId: agentData?.id,
    baseline,
    cached,
    // 嵌套比较:server 键集合 + 每 server 的 tool 集合(顺序无关)。
    equals: (a, b) => {
      if (a.size !== b.size) return false;
      for (const [name, selected] of a) {
        const other = b.get(name);
        if (!other) return false;
        if (!setEquals(selected, other)) return false;
      }
      return true;
    },
    // 规范化指纹:server 按名排序,每 server 的 tools 排序。
    fingerprint: (map) =>
      JSON.stringify(
        Array.from(map.entries())
          .map(([name, tools]) => [name, Array.from(tools).sort()] as const)
          .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)),
      ),
    toPayload: (map) => ({
      mcpServers: Array.from(map.entries()).map(([name, tools]) => ({ name, tools: Array.from(tools) })),
    }),
    onDataChange,
  });

  // 构造给 conflict helper 的 ToolSource[]
  const conflictSources = useMemo(
    () =>
      (servers || []).map((s) => ({
        name: s.name,
        availableTools: (s.tools || []).map((t) => ({ name: t.name })),
      })),
    [servers],
  );

  const selectionsForConflict: SelectionsMap = serverSelections;

  const conflicts = useMemo(
    () => detectGlobalConflicts(conflictSources, selectionsForConflict),
    [conflictSources, selectionsForConflict],
  );

  // server 状态:基于 runtime status 派生
  const getCurrentState = useCallback((server: { status?: string; error?: string; tools?: unknown[] }) => {
    const tools = server.tools || [];
    const hasError = !!server.error;
    if (server.status === 'connecting') return 'connecting';
    if (server.status === 'disconnecting') return 'disconnecting';
    if (server.status === 'error') return 'error';
    if (server.status === 'connected' && tools.length > 0) return 'connected';
    if (server.status !== 'connected' && hasError) return 'error';
    return server.status || 'disconnected';
  }, []);

  // server 切换选中
  const handleServerToggle = useCallback(
    (serverName: string, serverTools: { name: string }[]) => {
      if (readOnly) return;
      setServerSelections((prev) => {
        const next = new Map(prev);
        if (next.has(serverName)) {
          next.delete(serverName);
        } else {
          // 冲突检测:把整个 server 加入选中前,看它内部哪些 tool 已经被别处占了
          const conflicting: string[] = [];
          const nonConflicting: string[] = [];
          serverTools.forEach((t) => {
            if (checkToolConflict(conflictSources, prev, t.name, serverName)) {
              conflicting.push(t.name);
            } else {
              nonConflicting.push(t.name);
            }
          });
          if (conflicting.length > 0) {
            const message = (
              <div>
                <div className="text-red-700 mb-3">
                  {conflicting.length} tools from{' '}
                  <span className="font-bold">{serverName}</span> cannot be selected due to
                  same-name tools already selected in other MCP servers.
                </div>
                <ul className="list-none space-y-1 mb-0 ml-2">
                  {conflicting.map((tool) => (
                    <li key={tool} className="text-red-600">
                      • {tool}
                    </li>
                  ))}
                </ul>
              </div>
            );
            showToast(message, 'error', undefined, { persistent: true });
            if (nonConflicting.length > 0) {
              next.set(serverName, new Set(nonConflicting));
            }
          } else {
            // 无冲突:整 server 全选(用空 Set 表示)
            next.set(serverName, new Set<string>());
          }
        }
        return next;
      });
    },
    [readOnly, conflictSources, showToast],
  );

  // tool 切换选中
  const handleToolToggle = useCallback(
    (serverName: string, toolName: string, serverTools: { name: string }[]) => {
      if (readOnly) return;
      setServerSelections((prev) => {
        const next = new Map(prev);
        const current = next.get(serverName);
        if (!current) {
          // 未选中:本 server 入选 + 仅此 tool。先查冲突。
          if (checkToolConflict(conflictSources, prev, toolName, serverName)) {
            showToast(
              <div>
                <div className="text-red-700">
                  <span className="font-bold">{toolName}</span> cannot be selected due to
                  same-name tool already selected in other MCP servers.
                </div>
              </div>,
              'error',
              undefined,
              { persistent: true },
            );
            return prev;
          }
          next.set(serverName, new Set([toolName]));
        } else if (current.size === 0) {
          // 全选状态:把此 tool 排除掉(切到白名单除去)
          const remaining = new Set(serverTools.map((t) => t.name));
          remaining.delete(toolName);
          next.set(serverName, remaining);
        } else {
          // 部分选中
          const updated = new Set(current);
          if (updated.has(toolName)) {
            updated.delete(toolName);
            if (updated.size === 0) {
              next.delete(serverName);
            } else {
              next.set(serverName, updated);
            }
          } else {
            if (checkToolConflict(conflictSources, prev, toolName, serverName)) {
              showToast(
                <div>
                  <div className="text-red-700">
                    <span className="font-bold">{toolName}</span> cannot be selected due to
                    same-name tool already selected in other MCP servers.
                  </div>
                </div>,
                'error',
                undefined,
                { persistent: true },
              );
              return prev;
            }
            updated.add(toolName);
            if (updated.size === serverTools.length) {
              // 全选:压成空 Set
              next.set(serverName, new Set<string>());
            } else {
              next.set(serverName, updated);
            }
          }
        }
        return next;
      });
    },
    [readOnly, conflictSources, showToast],
  );

  const handleServerExpand = useCallback((serverName: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverName)) next.delete(serverName);
      else next.add(serverName);
      return next;
    });
  }, []);

  const handleManageServers = useCallback(() => {
    navigate('/settings/mcp');
  }, [navigate]);



  // 统计可用工具数(只计 connected server)
  const totalSelectedTools = useMemo(() => {
    let count = 0;
    serverSelections.forEach((selected, serverName) => {
      const server = servers?.find((s) => s.name === serverName);
      if (!server) return;
      if (getCurrentState(server) !== 'connected') return;
      const tools = server.tools || [];
      count += selected.size === 0 ? tools.length : selected.size;
    });
    return count;
  }, [serverSelections, servers, getCurrentState]);

  const filteredServers = useMemo(() => {
    if (!servers) return [];
    if (!searchQuery) return servers;
    return servers.filter((s) => s.name?.includes(searchQuery));
  }, [servers, searchQuery]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-black/7">
        <span className="text-sm text-sc-foreground">
          <strong className="font-semibold">{totalSelectedTools}</strong>
          <span className="text-sc-muted-foreground"> tools selected from external MCP servers</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleManageServers}
          title="Manage available servers"
        >
          Manage Available Servers
        </Button>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-sc-muted-foreground p-2">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading MCP servers...</span>
        </div>
      ) : !servers || servers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sc-muted-foreground">
          <Cable className="size-10 opacity-40" />
          <p className="text-sm font-medium">No MCP Servers Found</p>
          <p className="text-xs">No external MCP servers are currently configured.</p>
          <Button variant="outline" size="sm" onClick={handleManageServers} className="mt-1">
            Configure MCP Servers
          </Button>
        </div>
      ) : (
        <div className="p-2 flex flex-col gap-2">
          <ListSearchBox
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search MCP servers..."
          />
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col gap-2">
              {filteredServers.map((server) => (
                <li key={server.name}>
                  <AgentMcpServerCard
                    server={server}
                    selectedTools={serverSelections.get(server.name)}
                    isSelected={serverSelections.has(server.name)}
                    isExpanded={expandedServers.has(server.name)}
                    readOnly={readOnly}
                    currentState={getCurrentState(server)}
                    hasConflicts={sourceHasConflicts(conflicts, server.name)}
                    isToolConflicted={(toolName) =>
                      isToolConflicted(conflicts, toolName, server.name)
                    }
                    getConflictTooltip={(toolName) => getConflictTooltip(conflicts, toolName)}
                    conflictPeers={(toolName) =>
                      conflicts.get(toolName)?.sources.filter((s) => s !== server.name) ?? []
                    }
                    onServerToggle={handleServerToggle}
                    onToolToggle={handleToolToggle}
                    onServerExpand={handleServerExpand}
                    onManageServers={handleManageServers}
                  />
                </li>
              ))}
            </ul>
          </ScrollArea>
        </div>
      )}
    </div>
  );
};

export default AgentMcpServersTab;
