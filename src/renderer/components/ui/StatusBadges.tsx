import React, { useState, useEffect } from 'react';
import { Badge } from '@/shadcn/badge';
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom';
import { useAgentDetail } from '@/states/agentDetail.atom';
import { useSkills as useSkillsAtom } from '@/states/skills.atom';
import { useLocalTools } from '@/states/tools.atom';
import { agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { editAgent, type AgentEditTab } from '@/lib/chat/editAgent';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';

interface StatusBadgeProps {
  agentId: string | null;
  label: string;
  count: number;
  description: string;
  tab: AgentEditTab;
}

function StatusBadge({
  agentId,
  label,
  count,
  description,
  tab,
}: StatusBadgeProps): React.JSX.Element {
  return (
    <Badge
      variant="secondary"
      className="cursor-pointer text-xs"
      title={`Current Agent has ${count} available ${description} (Click to manage ${description})`}
      onClick={() => editAgent(agentId, tab)}
    >
      {label}: {count}
    </Badge>
  );
}

function useCurrentAgentId(): string | null {
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(
    agentSessionCacheManager.getCurrentAgentId()
  );

  useEffect(() => agentSessionCacheManager.subscribeToCurrentChatSessionId(() => {
    setCurrentAgentId(agentSessionCacheManager.getCurrentAgentId());
  }), []);

  return currentAgentId;
}

export function StatusBadges(): React.JSX.Element {
  const currentAgentId = useCurrentAgentId();
  const servers = useMcpRuntimeServers();
  const detail = useAgentDetail(currentAgentId);
  const localTools = useLocalTools();
  const globalSkills = useSkillsAtom();
  const agentMcpServers = detail?.mcpServers ?? [];
  const enabledToolNames = detail?.tools ?? [];
  const agentSkillNames = Object.keys(detail?.skills ?? {});

  // 连接或工具列表变化时，也必须重新计算 MCP 工具数。
  void servers;

  const skillsCount = agentSkillNames.filter((name) => globalSkills.some((skill) => skill.name === name)).length;
  const mcpToolsCount = currentAgentId && detail
    ? mcpClientCacheManager.getAgentSpecificTools(agentMcpServers).length
    : 0;
  let toolsCount = 0;

  if (currentAgentId && detail) {
    toolsCount = enabledToolNames.length === 0
      ? localTools.length
      : localTools.filter((tool) => enabledToolNames.includes(tool.name)).length;
  }

  return (
    <div className="flex items-center gap-1 flex-nowrap">
      <StatusBadge
        agentId={currentAgentId}
        label="skills"
        count={skillsCount}
        description="skills"
        tab="skills"
      />
      <StatusBadge
        agentId={currentAgentId}
        label="mcp tools"
        count={mcpToolsCount}
        description="MCP tools"
        tab="mcp"
      />
      <StatusBadge
        agentId={currentAgentId}
        label="tools"
        count={toolsCount}
        description="local tools"
        tab="tools"
      />
    </div>
  );
}


export default StatusBadges;