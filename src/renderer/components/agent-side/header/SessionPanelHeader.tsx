import React, { useCallback } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Badge } from '@/shadcn/badge';
import type { AgentRecord } from '@shared/persist/types';
import { AgentMenuAtom } from '@/components/menu/AgentDropdownMenu';
import AlarmToggleButton, { type SessionPanelMode } from './AlarmToggleButton';

interface SessionPanelHeaderProps {
  agentId: string | null;
  agent: AgentRecord | null;
  mode: SessionPanelMode;
  sessionId: string | null;
}

/**
 * Top strip of the SessionPanel: agent name + alarm toggle + agent dropdown.
 * The alarm and the rest of the panel below derive their state from the URL
 * (see `SessionPanel`); this component is purely presentational.
 */
const SessionPanelHeader: React.FC<SessionPanelHeaderProps> = ({ agentId, agent, mode, sessionId }) => {
  const agentMenuActions = AgentMenuAtom.useChange();

  const handleMore = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (agentId) {
      agentMenuActions.toggle(agentId, e.currentTarget);
    }
  }, [agentId, agentMenuActions]);

  const agentName = agent?.name || 'No Agent Selected';
  const isBuiltin = agent?.locked === true;

  return (
    <div
      data-dbg="session-panel-header"
      className="flex items-center h-11 pl-[6px] mt-[2px] shrink-0 border-b border-black/[0.06] mb-1"
    >
      <span
        data-dbg="session-panel-agent-name"
        className="flex-1 text-left text-sm font-semibold text-black/80"
        title={agentName}
      >
        {agentName}
        {isBuiltin && (
          <Badge className="bg-gradient-to-br from-purple-300 to-purple-400 text-white border-0 px-1.5 py-0 text-[0.55rem] rounded align-super relative -top-1">
            Built-in
          </Badge>
        )}
      </span>
      <div
        data-dbg="session-panel-header-actions"
        className="flex items-center gap-[2px] shrink-0"
      >
        <AlarmToggleButton agentId={agentId} mode={mode} sessionId={sessionId} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleMore}
          title="More"
          disabled={!agentId}
        >
          <MoreHorizontal size={14} />
        </Button>
      </div>
    </div>
  );
};

export default SessionPanelHeader;
