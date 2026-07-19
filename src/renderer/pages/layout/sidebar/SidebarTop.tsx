import React, { useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { useAgentUnreadSummaryMap } from '@/lib/chat/useAgentUnreadSummary';
import { newEntityId } from '@shared/persist/id';
import { useAgents } from '@/states/agents.atom';
import { SidebarAgentItem } from './SidebarAgentItem';
import { CurrentSession } from '@/states/currentSession.atom';

const SIDEBAR_ICON_SIZE = 14;

export const SidebarTop: React.FC = () => {
  const agents = useAgents();
  const location = useLocation();
  const navigate = useNavigate();

  const allAgentIds = useMemo(() => agents.map(a => a.id), [agents]);
  const unreadSummaryMap = useAgentUnreadSummaryMap(allAgentIds);

  const currentAgentId = useMemo(() => {
    const match = location.pathname.match(/\/agent\/(?!creation(?:\/|$))([^/]+)/);
    return match ? match[1] : CurrentSession.get().agentId;
  }, [location.pathname]);

  const isAgentRoute = location.pathname.startsWith('/agent');
  const isCreationRoute = location.pathname.startsWith('/agent/creation');

  const handleAgentClick = useCallback((agentId: string) => {
    navigate(`/agent/${agentId}/${newEntityId('s')}`);
  }, [navigate]);

  const handleNewAgent = () => {
    if (isCreationRoute) {
      navigate('/agent/creation', { replace: true, state: { refresh: Date.now() } });
    } else {
      navigate('/agent/creation');
    }
  };

  const isItemActive = (agentId: string) =>
    isAgentRoute && currentAgentId === agentId && !isCreationRoute;

  return (
    <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden pt-1.5 pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {agents.map(agent => (
        <SidebarAgentItem
          key={agent.id}
          agent={agent}
          isActive={isItemActive(agent.id)}
          unreadSummary={unreadSummaryMap[agent.id]}
          onClick={() => handleAgentClick(agent.id)}
        />
      ))}

      <Button
        variant="ghost"
        size="icon"
        className={`relative flex items-center justify-center w-7 h-7 p-0 shrink-0 rounded-[7px] border-[1.5px] transition-[background-color,border-color] duration-150 text-black/40 hover:text-black/70 ${isCreationRoute ? 'border-black/12 bg-black/[0.07]' : 'border-transparent bg-transparent hover:bg-black/5'}`}
        onClick={handleNewAgent}
        title="New Agent"
      >
        <Plus size={SIDEBAR_ICON_SIZE} />
      </Button>
    </div>
  );
};
