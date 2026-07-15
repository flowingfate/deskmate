import React, { memo, useEffect } from 'react';
import ChatContainer from './ChatContainer';
import { ComposeInput } from './chat-input';
import { useCurrentChatSessionId, useMessagesWithStream, ChatStatus, CurrentSessionInteractiveRequests } from '../../lib/chat/agentSessionCacheManager';
import { sendUserMessage } from '@renderer/lib/chat/sendUserMessageOptimistically';
import { editMessageAtom } from './message/edit-message.atom';
import ChatFilePreviewOverlay from '../filePreview/ChatFilePreviewOverlay';
import { ChatFilePreviewScope } from '../filePreview/filePreviewScope';
import { ChatFilePreviewAtom } from '../filePreview/filePreview.atom';
import { WorkspaceExplorerAtom } from './chat-side.atom';
import WorkspaceExplorerSidepane from './workspace/WorkspaceExplorerSidepane';
import InteractiveAuthCard from './interactive/AuthCard';
import InteractiveRequestCard from './interactive/RequestCard';
import InteractiveSearchCard from './interactive/SearchCard';
import { ZeroState } from './zero';
import ChatRibbon from './ribbon';
import { JobRunComposer, JobRunEmptyContent } from './JobRunChat';

interface ChatViewContentProps {
  // ChatContainer props
  isSessionSwitching?: boolean;
  // Chat status support
  agentId?: string;
  chatStatus?: ChatStatus;
  kind: 'regular' | 'job';
}

function WithInteractive(props: {
  children: React.ReactNode;
}) {
  const list = CurrentSessionInteractiveRequests.use();
  if (list.length === 0) return props.children;

  const pending = list[0];
  const card = pending.type === 'device-auth'
      ? <InteractiveAuthCard data={pending} />
      : pending.type === 'interactive-search'
        ? <InteractiveSearchCard data={pending} />
        : <InteractiveRequestCard data={pending} />;

  return (
    <div className={'absolute bottom-0 left-0 right-0 max-h-[70%] overflow-y-auto border-t border-black/7 bg-(--bg-primary) shadow-[0_-8px_24px_rgba(0,0,0,0.06)]'}>
      {card}
    </div>
  );
}

/** 右侧工作区浮层 — 绝对定位覆盖在消息区(messages region)上,不挡 ComposeInput。 */
function ChatWorkspaceSideOverlay() {
  const [{ visible }] = WorkspaceExplorerAtom.use();
  if (!visible) return null;
  return (
    <div className="absolute top-0 right-0 h-full w-95 flex flex-col bg-white border-l border-black/[0.07] shadow-[-8px_0_24px_-12px_rgba(15,23,42,0.18)]">
      <WorkspaceExplorerSidepane />
    </div>
  );
}


const ChatViewContent: React.FC<ChatViewContentProps> = memo(({
  isSessionSwitching = false,
  agentId,
  chatStatus,
  kind,
}) => {
  const { messages, streamingMessageId } = useMessagesWithStream();
  const [editingMessageState, editMessageActions] = editMessageAtom.use();

  const currentChatSessionId = useCurrentChatSessionId();
  const filePreviewActions = ChatFilePreviewAtom.useChange();
  // Close preview when switching chat sessions
  useEffect(() => {
    filePreviewActions.cancel();
    editMessageActions.cancel();
  }, [currentChatSessionId]);

  function renderContent() {
    if (isSessionSwitching) {
      return (
        <div className="chat-session-transition-state w-full mx-auto flex-1 flex items-center justify-center min-h-0" role="status" aria-live="polite">
          <div className="px-6 py-4.5 border border-[rgba(28,28,28,0.08)] rounded-full bg-[linear-gradient(180deg,rgba(250,250,250,0.96)_0%,rgba(245,245,245,0.98)_100%)] text-[#585858] text-sm leading-normal shadow-[0_10px_30px_rgba(28,28,28,0.06)]">
            Opening chat history...
          </div>
        </div>
      );
    }
    if (messages.length === 0) {
      if (kind === 'job') return <JobRunEmptyContent />;
      return <ZeroState />;
    }
    return (
      <ChatContainer
        messages={messages}
        streamingMessageId={streamingMessageId}
        agentId={agentId}
        chatSessionId={currentChatSessionId || undefined}
        chatStatus={chatStatus}
        editingMessage={editingMessageState}
        canEditUserMessage={!(kind === 'job' || isSessionSwitching || (chatStatus && chatStatus !== 'idle'))}
      />
    );
  }

  return (
    <ChatFilePreviewScope>
      <div className="relative flex flex-col flex-1 h-full overflow-hidden bg-(--bg-primary) min-w-0">
        <div className="relative flex flex-col flex-1 overflow-hidden">
          {renderContent()}
          <ChatWorkspaceSideOverlay />
        </div>
        <WithInteractive>
          <ChatRibbon />
          {kind === 'job'  ? (
            <JobRunComposer />
          ) : (
            <ComposeInput
              onSendMessage={sendUserMessage}
              chatStatus={chatStatus}
              enableContextMenu
              chatSessionId={currentChatSessionId}
              isInputLocked={!!editingMessageState || isSessionSwitching}
            />
          )}
        </WithInteractive>
        <ChatFilePreviewOverlay />
      </div>
    </ChatFilePreviewScope>
  );
});

ChatViewContent.displayName = 'ChatViewContent';

export default ChatViewContent;
