import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/shadcn/button';
import ListSearchBox from '@/components/ui/ListSearchBox';
import { SessionList } from './SessionList';

interface SessionsViewProps {
  /** Always defined here — `SessionPanel` only mounts this view when a agentId exists. */
  agentId: string;
  currentChatSessionId: string | null;
}

/**
 * Sessions sub-screen: search box + scrollable session list + new-conversation button.
 * Delete/fork events bubble through the existing `chatSession:*` window events;
 * `ChatView` owns the actual handlers.
 */
const SessionsView: React.FC<SessionsViewProps> = ({ agentId, currentChatSessionId }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  // Reset the query when the user switches agents — search context is per-agent.
  useEffect(() => {
    setSearchQuery('');
  }, [agentId]);

  const handleSelectChatSession = useCallback((agentId: string, sessionId: string) => {
    navigate(`/agent/${agentId}/${sessionId}`);
  }, [navigate]);

  const handleDeleteChatSession = useCallback((_agentId: string, sessionId: string) => {
    window.dispatchEvent(new CustomEvent('chatSession:delete', { detail: { sessionId } }));
  }, []);

  const handleForkChatSession = useCallback((_agentId: string, sessionId: string) => {
    window.dispatchEvent(new CustomEvent('chatSession:fork', { detail: { sessionId } }));
  }, []);

  const handleNewConversation = useCallback(() => {
    navigate(`/agent/${agentId}`, {
      state: { intent: 'new-chat', source: 'session-panel' },
    });
  }, [agentId, navigate]);

  return (
    <div data-dbg="sessions-view" className="contents">
      <ListSearchBox
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search conversations"
        className="my-1 shadow-none"
      />

      <div data-dbg="sessions-view-list" className="flex-1 min-h-0 overflow-hidden">
        <SessionList
          agentId={agentId}
          currentChatSessionId={currentChatSessionId}
          searchQuery={searchQuery}
          onSelectChatSession={handleSelectChatSession}
          onDeleteChatSession={handleDeleteChatSession}
          onForkChatSession={handleForkChatSession}
        />
      </div>

      <div className="shrink-0 pt-2 pb-3.75">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={handleNewConversation}
          title="New Conversation"
        >
          <Plus size={14} />
          <span>New Conversation</span>
        </Button>
      </div>
    </div>
  );
};

export default SessionsView;
