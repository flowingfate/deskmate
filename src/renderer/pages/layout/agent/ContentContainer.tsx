import React, { useCallback, useEffect, memo } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { AgentContextType } from '@/types/agentContextTypes';
import { useCurrentAgentId } from '@/lib/chat/agentSessionCacheManager';
import { log } from '@/log';
const logger = log.child({ mod: 'ContentContainer' });

interface ContentContainerProps {
  sidebarVisible?: boolean;
}

const ContentContainer: React.FC<ContentContainerProps> = () => {
  const navigate = useNavigate();
  const currentAgentId = useCurrentAgentId();

  // 🔥 Handle new Agent - navigate to the creation page
  const handleNewAgentInternal = useCallback(() => {
    navigate('/agent/creation');
  }, [navigate]);

  // 🔥 Handle edit Agent - navigate to the settings page
  const handleEditAgentInternal = useCallback(
    (agentId: string, initialTab?: 'basic' | 'mcp' | 'skills' | 'prompt') => {
      // Tab route mapping - kept in sync with tabToRouteMap in AgentEditingView
      const tabToRouteMap: Record<string, string> = {
        'basic': 'basic',
        'mcp': 'mcp_servers',
        'skills': 'skills',
        'prompt': 'system_prompt',
      };

      const routeTab = initialTab ? tabToRouteMap[initialTab] || 'basic' : 'basic';
      navigate(`/agent/${agentId}/settings/${routeTab}`);
    },
    [navigate],
  );

  // Listen for agent operation events (agent:newAgent / agent:editAgent)
  useEffect(() => {
    const handleNewAgentEvent = () => {
      handleNewAgentInternal();
    };

    const handleEditAgentEvent = (event: CustomEvent) => {
      const { agentId, initialTab } = event.detail;
      // If no agentId is provided, use the current agentId
      const targetAgentId = agentId || currentAgentId;
      if (targetAgentId) {
        handleEditAgentInternal(targetAgentId, initialTab);
      }
    };

    window.addEventListener('agent:newAgent', handleNewAgentEvent);
    window.addEventListener(
      'agent:editAgent',
      handleEditAgentEvent as EventListener,
    );

    return () => {
      window.removeEventListener('agent:newAgent', handleNewAgentEvent);
      window.removeEventListener(
        'agent:editAgent',
        handleEditAgentEvent as EventListener,
      );
    };
  }, [
    handleNewAgentInternal,
    handleEditAgentInternal,
    currentAgentId,
  ]);

  const agentContext: AgentContextType = {};

  return (
    <main className="flex-1 flex flex-col overflow-hidden relative pl-0.5" role="main" aria-live="polite">
      <Outlet context={agentContext} />
    </main>
  );
};

export default memo(ContentContainer);
