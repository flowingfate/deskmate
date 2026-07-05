import React, { useState, useEffect } from 'react';
import { Badge } from '@/shadcn/badge';
import { useMcpRuntimeServers } from '@/states/mcpRuntime.atom';
import ContextBadge from './ContextBadge';
import { useAgentDetail } from '@/states/agentDetail.atom';
import { useSkills as useSkillsAtom } from '@/states/skills.atom';
import { agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { mcpClientCacheManager } from '../../lib/mcp/mcpClientCacheManager';

interface StatusBadgesProps {
  onOpenMcpTools?: () => void;
  onOpenSkills?: () => void;
}

interface AvailableToolsBadgeProps {
  onOpenMcpTools?: () => void;
}

const AvailableToolsBadge: React.FC<AvailableToolsBadgeProps> = ({
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
  const toolsCount = currentAgentId && detail
    ? mcpClientCacheManager.getAgentSpecificTools(agentMcpServers).length
    : 0;

  return (
    <Badge
      variant="secondary"
      className={`text-xs ${onOpenMcpTools ? 'cursor-pointer' : 'cursor-help'}`}
      title={`Current Agent has ${toolsCount} available tools${onOpenMcpTools ? ' (Click to manage tools)' : ''}`}
      onClick={onOpenMcpTools}
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
  const agentSkillNames = detail?.skills ?? [];
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
  onOpenSkills
}) => {
  return (
    <div className="flex items-center gap-1 flex-nowrap">
      <AvailableSkillsBadge
        onOpenSkills={onOpenSkills}
      />
      <AvailableToolsBadge
        onOpenMcpTools={onOpenMcpTools}
      />
      <ContextBadge />
    </div>
  );
};

export default StatusBadges;