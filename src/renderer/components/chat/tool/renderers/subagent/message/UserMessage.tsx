import type { Message } from '@shared/persist/types';
import { MarkdownView } from '../../../../message/MarkdownView';
import { MessageCard } from './MessageCard';

const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

export function stripSystemReminders(content: string): string {
  return content.replace(SYSTEM_REMINDER_PATTERN, '').trim();
}

interface UserMessageProps {
  message: Extract<Message, { role: 'user' }>;
}

export function UserMessage({ message }: UserMessageProps) {
  const visibleContent = stripSystemReminders(message.content);
  const hasContent = visibleContent.length > 0;
  const hasAttachments = message.attachments.length > 0;

  if (!hasContent && !hasAttachments) return null;

  return (
    <MessageCard label="Task" time={message.time} tone="user">
      {hasContent ? <MarkdownView text={visibleContent} /> : null}
      {hasAttachments ? (
        <p className="mt-2 mb-0 text-xs text-gray-500">
          Attachments: {message.attachments.map((attachment) => attachment.fileName).join(', ')}
        </p>
      ) : null}
    </MessageCard>
  );
}
