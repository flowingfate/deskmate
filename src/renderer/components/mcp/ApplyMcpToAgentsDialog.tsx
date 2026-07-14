/**
 * ApplyMcpToAgentsDialog
 *
 * MCP server 添加后弹出（来自 device / MCP config import / library），让用户选哪些 agent
 * 应用这些 MCP server（支持批量名称）。比另两个 Apply 多了一层"工具冲突检测 + 冲突
 * 报告页"：若新 MCP server 的 tool 名与 agent 已有 server 的 tool 名冲突，那些 tool
 * 会被排除，最终弹出报告页告知用户。
 *
 * 通用列表 + 状态机抽到 `components/agentSelection/`。
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom';
import { updateAgent } from '@/lib/chat/agentOps';
import { useToast } from '../ui/ToastProvider';
import {
  AgentSelectionList,
  useApplyToAgentsState,
} from '../agentSelection';

interface ApplyMcpToAgentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Single MCP server name or array of names (for bulk import) */
  mcpServerNames: string[];
}

/** Per-agent conflict report */
interface AgentConflictReport {
  agentName: string;
  /** tool name -> which existing server already has it */
  conflicts: { toolName: string; existingServer: string }[];
  addedToolCount: number;
  totalNewToolCount: number;
}

const ApplyMcpToAgentsDialog: React.FC<ApplyMcpToAgentsDialogProps> = ({
  open,
  onOpenChange,
  mcpServerNames,
}) => {
  const mcpRuntimeServers = useMcpRuntimeServers();
  const { showSuccess, showError, showWarning } = useToast();
  const [isApplying, setIsApplying] = useState(false);
  const [conflictReports, setConflictReports] = useState<AgentConflictReport[]>([]);
  const [showConflictSummary, setShowConflictSummary] = useState(false);
  const conflictCloseRef = useRef<HTMLButtonElement>(null);

  // Display label for the dialog description
  const displayLabel = useMemo(() => {
    if (mcpServerNames.length === 1) return `"${mcpServerNames[0]}"`;
    return `${mcpServerNames.length} MCP servers`;
  }, [mcpServerNames]);

  // Build a map: serverName -> Set<toolName> from runtime info
  const serverToolsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const server of mcpRuntimeServers) {
      const toolNames = new Set((server.tools || []).map((t) => t.name));
      map.set(server.name, toolNames);
    }
    return map;
  }, [mcpRuntimeServers]);

  /**
   * Resolve the effective tool names an agent uses from a given MCP server entry.
   * - If entry.tools is non-empty: those specific tools
   * - If entry.tools is empty (all tools): look up runtime to get all tool names
   */
  const resolveAgentToolNames = useCallback(
    (entry: { name: string; tools: string[] }): Set<string> => {
      if (entry.tools && entry.tools.length > 0) return new Set(entry.tools);
      // Empty tools = all tools from this server
      return serverToolsMap.get(entry.name) || new Set();
    },
    [serverToolsMap],
  );

  // mcpServerNames 是数组；用 join 作为 resourceKey 用于资源切换时重置预选。
  // MCP server name 不含逗号，简单 join 足以唯一。
  const resourceKey = mcpServerNames.join(',');

  const state = useApplyToAgentsState({
    open,
    resourceKey,
    isAlreadyApplied: useCallback(
      (detail) => {
        const existingNames = new Set((detail.mcpServers ?? []).map((s) => s.name));
        return mcpServerNames.every((name) => existingNames.has(name));
      },
      [mcpServerNames],
    ),
  });
  const { agentItems, selectedAgents, details, detailsReady, newlySelectedCount } = state;

  const handleApply = useCallback(async () => {
    const toApply = agentItems.filter(
      (item) => !item.alreadyApplied && selectedAgents.has(item.agentId),
    );

    if (toApply.length === 0) {
      onOpenChange(false);
      return;
    }

    setIsApplying(true);
    let successCount = 0;
    let failCount = 0;
    const reports: AgentConflictReport[] = [];

    for (const item of toApply) {
      const detail = details[item.agentId];
      if (!detail) continue;

      const currentMcpServers = detail.mcpServers || [];
      const existingNames = new Set(currentMcpServers.map((s) => s.name));

      // Collect all tool names currently used by this agent (across all existing MCP servers)
      // Map: toolName -> serverName (which server provides it)
      const existingToolOwnership = new Map<string, string>();
      for (const entry of currentMcpServers) {
        const toolNames = resolveAgentToolNames(entry);
        for (const toolName of toolNames) {
          existingToolOwnership.set(toolName, entry.name);
        }
      }

      // Build new server entries with conflict filtering
      const newServers: { name: string; tools: string[] }[] = [];
      const agentConflicts: { toolName: string; existingServer: string }[] = [];
      let totalNewToolCount = 0;

      for (const serverName of mcpServerNames) {
        if (existingNames.has(serverName)) continue;

        const newServerTools = serverToolsMap.get(serverName);
        if (!newServerTools || newServerTools.size === 0) {
          // Server has no runtime tools info (maybe not connected yet), add with empty tools (all)
          newServers.push({ name: serverName, tools: [] });
          continue;
        }

        totalNewToolCount += newServerTools.size;
        const conflicting: string[] = [];
        const nonConflicting: string[] = [];

        for (const toolName of newServerTools) {
          const owner = existingToolOwnership.get(toolName);
          if (owner) {
            conflicting.push(toolName);
            agentConflicts.push({ toolName, existingServer: owner });
          } else {
            nonConflicting.push(toolName);
          }
        }

        if (conflicting.length > 0) {
          if (nonConflicting.length > 0) {
            // Has conflicts but also has non-conflicting tools: add only the non-conflicting ones
            newServers.push({ name: serverName, tools: nonConflicting });
          }
          // else: ALL tools conflict — skip this MCP server entirely for this agent
        } else {
          // No conflicts, add with empty tools (all)
          newServers.push({ name: serverName, tools: [] });
        }
      }

      if (newServers.length === 0) {
        // All MCP servers fully conflicted for this agent — report but don't update
        if (agentConflicts.length > 0) {
          reports.push({
            agentName: item.agentName,
            conflicts: agentConflicts,
            addedToolCount: 0,
            totalNewToolCount,
          });
        }
        continue;
      }

      const updatedMcpServers = [...currentMcpServers, ...newServers];
      const result = await updateAgent(item.agentId, { mcp_servers: updatedMcpServers });

      if (result.success) {
        successCount++;
        if (agentConflicts.length > 0) {
          // Count actually added tools: explicit list length, or all tools from runtime for [] entries
          const addedToolCount = newServers.reduce((sum, s) => {
            if (s.tools.length > 0) return sum + s.tools.length;
            // tools: [] means all tools from this server
            const runtimeTools = serverToolsMap.get(s.name);
            return sum + (runtimeTools ? runtimeTools.size : 0);
          }, 0);
          reports.push({
            agentName: item.agentName,
            conflicts: agentConflicts,
            addedToolCount,
            totalNewToolCount,
          });
        }
      } else {
        failCount++;
      }
    }

    setIsApplying(false);

    if (successCount > 0) {
      const serverLabel = mcpServerNames.length === 1
        ? `MCP server "${mcpServerNames[0]}"`
        : `${mcpServerNames.length} MCP servers`;

      if (reports.length > 0) {
        // Has conflicts - show warning with summary
        const totalConflicts = reports.reduce((sum, r) => sum + r.conflicts.length, 0);
        showWarning(
          `${serverLabel} applied to ${successCount} agent${successCount > 1 ? 's' : ''}. `
          + `${totalConflicts} conflicting tool${totalConflicts > 1 ? 's were' : ' was'} excluded.`,
        );
        setConflictReports(reports);
        setShowConflictSummary(true);
      } else {
        showSuccess(`${serverLabel} applied to ${successCount} agent${successCount > 1 ? 's' : ''}`);
        onOpenChange(false);
      }
    } else {
      if (failCount > 0) {
        showError(`Failed to apply MCP server(s) to ${failCount} agent${failCount > 1 ? 's' : ''}`);
      }
      onOpenChange(false);
    }
  }, [agentItems, selectedAgents, details, mcpServerNames, serverToolsMap, resolveAgentToolNames, onOpenChange, showSuccess, showWarning, showError]);

  const handleSkip = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleCloseConflictSummary = useCallback(() => {
    setShowConflictSummary(false);
    setConflictReports([]);
    onOpenChange(false);
  }, [onOpenChange]);

  // Conflict summary view
  if (showConflictSummary && conflictReports.length > 0) {
    return (
      <Dialog open={open} onOpenChange={handleCloseConflictSummary}>
        <DialogContent className="w-[480px] max-w-[480px]" initialFocusRef={conflictCloseRef}>
          <DialogHeader>
            <DialogTitle>Tool Conflict Report</DialogTitle>
            <DialogDescription>
              Some tools were excluded because they conflict with tools from existing MCP servers.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 max-h-[360px] overflow-y-auto space-y-4">
            {conflictReports.map((report) => (
              <div key={report.agentName} className="border border-gray-200 rounded-md p-3">
                <div className="text-sm font-medium text-gray-900 mb-2">
                  {report.agentName}
                  <span className={`ml-2 text-xs font-normal ${
                    report.addedToolCount === 0 ? 'text-red-500' : 'text-gray-500'
                  }`}>
                    {report.addedToolCount === 0
                      ? 'MCP server not added (all tools conflict)'
                      : `${report.addedToolCount}/${report.totalNewToolCount} tools added`}
                  </span>
                </div>
                <div className="space-y-1">
                  {report.conflicts.map((conflict, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-gray-600">
                      <span className="text-amber-500 shrink-0">excluded</span>
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
                        {conflict.toolName}
                      </code>
                      <span className="text-gray-400 shrink-0">
                        (exists in {conflict.existingServer})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button ref={conflictCloseRef} onClick={handleCloseConflictSummary}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Normal agent selection view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[480px] max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Apply to Agents</DialogTitle>
          <DialogDescription>
            Select which agents should use {displayLabel}.
          </DialogDescription>
        </DialogHeader>

        <AgentSelectionList state={state} />

        <DialogFooter>
          <Button variant="secondary" onClick={handleSkip} disabled={isApplying}>
            Skip
          </Button>
          <Button
            onClick={handleApply}
            disabled={isApplying || !detailsReady || newlySelectedCount === 0}
          >
            {isApplying ? 'Applying...' : `Apply${newlySelectedCount > 0 ? ` (${newlySelectedCount})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ApplyMcpToAgentsDialog;
