import { Button } from '@/shadcn/button';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import type { RunMessagesState } from './useRunMessages';

interface RunMessagesContentProps {
  agentId: string;
  sessionId: string;
  state: RunMessagesState;
  onRetry: () => void;
}

export function RunMessagesContent({ agentId, sessionId, state, onRetry }: RunMessagesContentProps) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'loading':
      return (
        <p className="m-0 text-sm text-sc-muted-foreground" aria-live="polite">
          Loading transcript…
        </p>
      );
    case 'error':
      return (
        <div
          className="flex flex-col items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900"
          role="alert"
        >
          <span>Transcript unavailable: {state.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Reload transcript
          </Button>
        </div>
      );
    case 'ready':
      if (state.messages.length === 0) {
        return (
          <p className="m-0 text-sm text-sc-muted-foreground">
            No messages were recorded for this run.
          </p>
        );
      }

      return (
        <div className="flex flex-col gap-2">
          {state.messages.map((message) => (
            message.role === 'user'
              ? <UserMessage key={message.id} message={message} />
              : <AssistantMessage agentId={agentId} sessionId={sessionId} key={message.id} message={message} />
          ))}
        </div>
      );
  }
}
