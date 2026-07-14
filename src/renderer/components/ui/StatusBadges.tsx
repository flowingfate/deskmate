import React, { useState, useEffect } from 'react';
import { Badge } from '@/shadcn/badge';
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom';
import { useAgentDetail } from '@/states/agentDetail.atom';
import { useSkills as useSkillsAtom } from '@/states/skills.atom';
import { useLocalTools } from '@/states/tools.atom';
import { agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';

interface StatusBadgesProps {
  onOpenMcpTools?: () => void;
  onOpenTools?: () => void;
  onOpenSkills?: () => void;
}

interface AvailableMcpBadgeProps {
  onOpenMcpTools?: () => void;
}

const AvailableMcpBadge: React.FC<AvailableMcpBadgeProps> = ({
  onOpenMcpTools
}) => {
  const servers = useMcpRuntimeServers();

  const [currentAgentId, setCurrentAgentId] = useState<string | null>(
    agentSessionCacheManager.getCurrentAgentId()
  );

  // Subscribe to currentAgentId changes
  useEffect(() => {
    const unsubscribe = agentSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newAgentId = agentSessionCacheManager.getCurrentAgentId();
      setCurrentAgentId(newAgentId);
    });
    return unsubscribe;
  }, []);

  // cold 字段（mcpServers）走 detail atom；未到时按 0 显示。
  const detail = useAgentDetail(currentAgentId);
  const agentMcpServers = detail?.mcpServers ?? [];
  // 依赖 servers 重算工具数：servers 变化（连接/工具列表变化）也要刷新
  void servers;
  const mcpToolsCount = currentAgentId && detail
    ? mcpClientCacheManager.getAgentSpecificTools(agentMcpServers).length
    : 0;

  return (
    <Badge
      variant="secondary"
      className={`text-xs ${onOpenMcpTools ? 'cursor-pointer' : 'cursor-help'}`}
      title={`Current Agent has ${mcpToolsCount} available MCP tools${onOpenMcpTools ? ' (Click to manage MCP tools)' : ''}`}
      onClick={onOpenMcpTools}
    >
      mcp tools: {mcpToolsCount}
    </Badge>
  );
};

interface AvailableToolsBadgeProps {
  onOpenTools?: () => void;
}

const AvailableToolsBadge: React.FC<AvailableToolsBadgeProps> = ({ onOpenTools }) => {
  const localTools = useLocalTools();
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(
    agentSessionCacheManager.getCurrentAgentId()
  );

  useEffect(() => {
    const unsubscribe = agentSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      setCurrentAgentId(agentSessionCacheManager.getCurrentAgentId());
    });
    return unsubscribe;
  }, []);

  const detail = useAgentDetail(currentAgentId);
  const enabledToolNames = detail?.tools ?? [];
  const toolsCount = currentAgentId && detail
    ? enabledToolNames.length === 0
      ? localTools.length
      : localTools.filter((tool) => enabledToolNames.includes(tool.name)).length
    : 0;

  return (
    <Badge
      variant="secondary"
      className={`text-xs ${onOpenTools ? 'cursor-pointer' : 'cursor-help'}`}
      title={`Current Agent has ${toolsCount} available local tools${onOpenTools ? ' (Click to manage tools)' : ''}`}
      onClick={onOpenTools}
    >
      tools: {toolsCount}
    </Badge>
  );
};

interface AvailableSkillsBadgeProps {
  onOpenSkills?: () => void;
}

const AvailableSkillsBadge: React.FC<AvailableSkillsBadgeProps> = ({
  onOpenSkills
}) => {
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(
    agentSessionCacheManager.getCurrentAgentId()
  );

  // Subscribe to currentAgentId changes
  useEffect(() => {
    const unsubscribe = agentSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newAgentId = agentSessionCacheManager.getCurrentAgentId();
      setCurrentAgentId(newAgentId);
    });
    return unsubscribe;
  }, []);

  // cold 字段（skills）走 detail atom；未到时按 0 显示。
  const detail = useAgentDetail(currentAgentId);
  const globalSkills = useSkillsAtom();
  const agentSkillNames = Object.keys(detail?.skills ?? {});
  const skillsCount = agentSkillNames.filter((n) => globalSkills.some((s) => s.name === n)).length;

  return (
    <Badge
      variant="secondary"
      className={`text-xs ${onOpenSkills ? 'cursor-pointer' : 'cursor-help'}`}
      title={`Current Agent has ${skillsCount} available skills${onOpenSkills ? ' (Click to manage skills)' : ''}`}
      onClick={onOpenSkills}
    >
      skills: {skillsCount}
    </Badge>
  );
};

export const StatusBadges: React.FC<StatusBadgesProps> = ({
  onOpenMcpTools,
  onOpenTools,
  onOpenSkills
}) => {
  return (
    <div className="flex items-center gap-1 flex-nowrap">
      <AvailableSkillsBadge
        onOpenSkills={onOpenSkills}
      />
      <AvailableMcpBadge onOpenMcpTools={onOpenMcpTools} />
      <AvailableToolsBadge onOpenTools={onOpenTools} />
    </div>
  );
};

export default StatusBadges;