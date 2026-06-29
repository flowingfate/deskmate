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
import './Message.scss';

interface UserMessageProps {
  message: RenderUserMessage;
  canEditUserMessage?: boolean;
  onEditUserMessage?: () => void;
}

const EditIcon: React.FC = () => (
  <svg
    className="action-icon"
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
  message,
  canEditUserMessage = false,
  onEditUserMessage,
}) => {
  const text = message.content;
  const canEdit = canEditUserMessage && !!onEditUserMessage;

  return (
    <div className="message-container user-message-container">
      <div className="message user-message">
        <div className="message-content markdown-body">
          <MarkdownView text={text} />
          <AttachmentList message={message} />
        </div>
      </div>
      <div className="message-metadata user-message-metadata">
        <div className="message-actions">
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
