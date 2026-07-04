import React, { useEffect, useState, useRef } from 'react';

import { Copy, Check } from 'lucide-react';
import { Button } from '@/shadcn/button';
import StatusBadges from '../ui/StatusBadges';
import { useCurrentAgent } from '@/states/agents.atom';
import { agentSessionCacheManager } from '../../lib/chat/agentSessionCacheManager';
import { AgentAvatar } from '../common/AgentAvatar';
import { log } from '@/log';
import { WorkspaceExplorerAtom } from './chat-side.atom';
import { appApi } from '@/ipc/app';

const logger = log.child({ mod: 'ChatViewHeader' });

function DevInfoBadge({ appVersion, agentId, sessionId }: {
  appVersion: string;
  agentId: string | null;
  sessionId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const copyValue = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const rows: { key: string; label: string; value: string; display?: string }[] = [
    { key: 'version', label: 'Version', value: appVersion },
    ...(agentId ? [{ key: 'chat', label: 'Chat ID', value: agentId }] : []),
    ...(sessionId ? [{ key: 'session', label: 'Session ID', value: sessionId }] : []),
    ...(agentId && sessionId
      ? [{
          key: 'both',
          label: 'Copy IDs',
          value: `agent: ${agentId}\nsession: ${sessionId}`,
          display: 'agent + session',
        }]
      : []),
  ];

  return (
    <div className="relative ml-2 shrink-0 flex items-center" ref={ref}>
      <button
        className={`text-[10px] font-semibold tracking-[0.5px] text-[#737373] border rounded-sm px-1.5 py-0.5 cursor-pointer whitespace-nowrap font-mono select-none transition-all duration-150 ${open ? 'bg-[rgba(115,115,115,0.15)] border-[rgba(115,115,115,0.4)]' : 'bg-[rgba(115,115,115,0.08)] border-[rgba(115,115,115,0.2)] hover:bg-[rgba(115,115,115,0.15)] hover:border-[rgba(115,115,115,0.4)]'}`}
        onClick={() => setOpen(v => !v)}
      >
        DEV
      </button>
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-1000 bg-white border border-border rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.1)] min-w-60 overflow-hidden">
          {rows.map(({ key, label, value, display }) => (
            <div key={key} className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer transition-[background] duration-100 hover:bg-[#fafafa] not-first:border-t not-first:border-(--bg-secondary)" onClick={() => copyValue(key, value)}>
              <span className="text-[11px] font-medium text-content-tertiary whitespace-nowrap shrink-0">{label}</span>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-content-heading break-all text-right [&_svg]:shrink-0 [&_svg]:text-content-tertiary">
                <span>{display ?? value}</span>
                {copied === key ? <Check size={12} /> : <Copy size={12} />}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChatViewHeaderProps {
  onOpenMcpTools?: () => void;
  onOpenSkills?: () => void;
  currentChatSessionId?: string | null;
}

const ChatViewHeader: React.FC<ChatViewHeaderProps> = ({
  onOpenMcpTools,
  onOpenSkills,
  currentChatSessionId,
}) => {
  // For programmatic navigation

  // Get currentAgentId from agentSessionCacheManager
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(
    agentSessionCacheManager.getCurrentAgentId()
  );

  // Get app version for development mode display
  const [appVersion, setAppVersion] = useState<string>('1.15.6');

  useEffect(() => {
    const unsubscribe = agentSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newAgentId = agentSessionCacheManager.getCurrentAgentId();
      setCurrentAgentId(newAgentId);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      appApi.getVersion().then((version) => {
        setAppVersion(version);
      }).catch(() => {
        setAppVersion('1.15.6');
      });
    }
  }, []);

  // Get current agent configuration data - depends on currentAgentId to update on switch
  const agent = useCurrentAgent();

  /**
   * Check whether all ChatSessions for the current agentId are in Idle state.
   * If any session is active, the config cannot be updated because it would affect ongoing sessions.
   */



  return (
    <>
      <div className="flex items-center gap-2">
        {agent && (
          <span className="inline-flex items-center">
            <AgentAvatar
              emoji={agent.emoji}
              avatar={agent.avatar}
              name={agent.name}
              size="md"
              version={agent.version}
            />
          </span>
        )}
        <span>{agent ? agent.name : 'Chat'}</span>
        <StatusBadges
          onOpenMcpTools={onOpenMcpTools}
          onOpenSkills={onOpenSkills}
        />
        {/* Development mode: Display version and current chat IDs */}
        {process.env.NODE_ENV === 'development' && (
          <DevInfoBadge
            appVersion={appVersion}
            agentId={currentAgentId}
            sessionId={currentChatSessionId}
          />
        )}
      </div>
      <div className="flex items-center shrink-0">
        <ToggleWorkspaceExplorer />
      </div>
    </>
  );
};

function ToggleWorkspaceExplorer() {
  const [{ visible }, actions] = WorkspaceExplorerAtom.use();
  return (
    <Button
      variant={visible ? "secondary" : "ghost"}
      size="icon-sm"
      onClick={actions.effectiveToggle}
      title={visible ? "Hide workspace explorer" : "Show workspace explorer"}
      aria-label={visible ? "Hide workspace explorer" : "Show workspace explorer"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <mask id="mask0_428_1507" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <path d="M3.5 6.25V8H8.12868C8.32759 8 8.51836 7.92098 8.65901 7.78033L10.1893 6.25L8.65901 4.71967C8.51836 4.57902 8.32759 4.5 8.12868 4.5H5.25C4.2835 4.5 3.5 5.2835 3.5 6.25ZM2 6.25C2 4.45507 3.45507 3 5.25 3H8.12868C8.72542 3 9.29771 3.23705 9.71967 3.65901L11.5607 5.5H18.75C20.5449 5.5 22 6.95507 22 8.75V17.75C22 19.5449 20.5449 21 18.75 21H5.25C3.45507 21 2 19.5449 2 17.75V6.25ZM3.5 9.5V17.75C3.5 18.7165 4.2835 19.5 5.25 19.5H18.75C19.7165 19.5 20.5 18.7165 20.5 17.75V8.75C20.5 7.7835 19.7165 7 18.75 7H11.5607L9.71967 8.84099C9.29771 9.26295 8.72542 9.5 8.12868 9.5H3.5Z" fill="#242424" />
        </mask>
        <g mask="url(#mask0_428_1507)">
          <rect width="24" height="24" fill="#272320" />
        </g>
      </svg>
    </Button>
  );
}


export default ChatViewHeader;