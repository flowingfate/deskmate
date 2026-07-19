/**
 * UserMessage — 渲染单条用户消息。
 *
 * 用户消息永远不流式，所以走 MarkdownView 直接渲染；附件部分抽到 AttachmentList。
 */

import React from 'react';
import type { RenderUserMessage } from '@/lib/chat/renderMessage';
import { Button } from '@/shadcn/button';
import { MarkdownView } from './MarkdownView';
import { CopyButton } from './CopyButton';
import { AttachmentList } from './AttachmentList';

interface UserMessageProps {
  agentId: string;
  sessionId: string;
  message: RenderUserMessage;
  canEditUserMessage?: boolean;
  onEditUserMessage?: () => void;
}

const EditIcon: React.FC = () => (
  <svg
    className="block shrink-0 text-[#6C6C70] transition-all"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);

const UserMessageInner: React.FC<UserMessageProps> = ({
  agentId,
  sessionId,
  message,
  canEditUserMessage = false,
  onEditUserMessage,
}) => {
  const text = message.content;
  const canEdit = canEditUserMessage && !!onEditUserMessage;

  return (
    <div data-dbg="user-message" className="group flex flex-col gap-2 min-w-0 contain-[layout_style] items-end">
      <div className="animate-[fadeIn_0.3s_ease-out] flex flex-col gap-2 px-2.5 py-0.5 rounded-md bg-[#f2f2f2] w-fit wrap-break-word [word-break:break-word] whitespace-normal">
        <div className="message-content relative wrap-break-word flex flex-col markdown-body">
          <MarkdownView text={text} />
          <AttachmentList agentId={agentId} sessionId={sessionId} message={message} />
        </div>
      </div>
      <div data-dbg="user-message-actions" className="flex flex-col gap-2 w-fit self-end items-end">
        <div className="flex items-center gap-2 flex-none justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          {canEdit && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEditUserMessage}
              title="Edit message"
              aria-label="Edit message"
            >
              <EditIcon />
            </Button>
          )}
          <CopyButton text={text} />
        </div>
      </div>
    </div>
  );
};

const UserMessage = React.memo(UserMessageInner);
UserMessage.displayName = 'UserMessage';

export default UserMessage;
