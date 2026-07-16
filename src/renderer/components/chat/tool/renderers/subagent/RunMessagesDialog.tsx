import { useEffect, useRef, useState } from 'react';
import type { Message, SubrunId } from '@shared/persist/types';
import { subagentRunApi } from '@/ipc/subagentRun';
import { Button } from '@/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shadcn/dialog';
import { MarkdownView } from '../../../message/MarkdownView';
import { GeneratedFileCards } from '../../../message/GeneratedFileCards';
import { SubagentStatusIcon } from './RunResultDetails';

type MessagesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; messages: Message[] }
  | { kind: 'error'; message: string };

interface SubagentRunMessagesDialogProps {
  parentAgentId: string;
  parentSessionId: string;
  subrunId: SubrunId;
  agentName: string;
  status: string;
  task: string | null;
  expectedOutput: string | null;
  durationMs: number | undefined;
  usage: { tokenUsage?: { total: number } } | null;
  deliverables: string[];
  turns: number;
  maxTurns: number | null;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '—';
  if (durationMs < 1_000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

function messagesError(result: Awaited<ReturnType<typeof subagentRunApi.getRunMessages>>): string | null {
  switch (result.kind) {
    case 'found':
      return null;
    case 'parent_not_found':
    case 'error':
      return result.error;
    case 'invalid_id':
      return 'The delegated run ID is invalid.';
    case 'missing':
      return 'The delegated run transcript is unavailable.';
    case 'incomplete':
      return 'The delegated run reservation is incomplete.';
    case 'corrupt':
      return 'The delegated run record is corrupt.';
  }
}

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function TranscriptToolCall({ message }: { message: Extract<Message, { role: 'assistant' }> }) {
  if (message.tool_calls.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {message.tool_calls.map((toolCall) => (
        <section key={toolCall.id} className="rounded-md border border-black/8 bg-gray-50 px-3 py-2">
          <p className="m-0 text-xs font-medium text-gray-700">Tool: {toolCall.name}</p>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-[11px] leading-4 text-gray-700">
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
          {toolCall.response ? (
            <pre className={`mt-1 whitespace-pre-wrap break-words rounded p-2 font-mono text-[11px] leading-4 ${toolCall.response.status === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>
              {toolCall.response.result}
            </pre>
          ) : (
            <p className="mt-1 text-xs text-gray-500">No response was recorded.</p>
          )}
        </section>
      ))}
    </div>
  );
}

function TranscriptMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const hasContent = message.content.trim().length > 0;

  return (
    <article className={`rounded-md border p-3 ${isUser ? 'border-sky-100 bg-sky-50/40' : 'border-black/8 bg-white'}`}>
      <header className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-gray-700">{isUser ? 'User' : 'Delegated Agent'}</span>
        <time className="shrink-0 text-gray-500" dateTime={new Date(message.time).toISOString()}>{formatTime(message.time)}</time>
      </header>
      {hasContent ? <MarkdownView text={message.content} /> : null}
      {isUser && message.attachments.length > 0 ? (
        <p className="mt-2 mb-0 text-xs text-gray-500">Attachments: {message.attachments.map((attachment) => attachment.fileName).join(', ')}</p>
      ) : null}
      {!isUser ? <TranscriptToolCall message={message} /> : null}
      {!hasContent && (isUser ? message.attachments.length === 0 : message.tool_calls.length === 0) ? (
        <p className="m-0 text-xs italic text-gray-500">No visible content was recorded.</p>
      ) : null}
    </article>
  );
}

export function SubagentRunMessagesDialog({
  parentAgentId,
  parentSessionId,
  subrunId,
  agentName,
  status,
  task,
  expectedOutput,
  durationMs,
  turns,
  maxTurns,
  usage,
  deliverables,
}: SubagentRunMessagesDialogProps) {
  const [open, setOpen] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [messagesState, setMessagesState] = useState<MessagesState>({ kind: 'idle' });
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;

    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setMessagesState({ kind: 'loading' });
    void (async () => {
      try {
        const result = await subagentRunApi.getRunMessages({ parentAgentId, parentSessionId, subrunId });
        if (requestId.current !== currentRequestId) return;
        if (result.kind === 'found') {
          setMessagesState({ kind: 'ready', messages: result.messages });
          return;
        }
        setMessagesState({ kind: 'error', message: messagesError(result) ?? 'Unable to load the run transcript.' });
      } catch (error) {
        if (requestId.current === currentRequestId) {
          setMessagesState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
  }, [open, parentAgentId, parentSessionId, requestVersion, subrunId]);

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen);
    if (!nextOpen) {
      requestId.current += 1;
      setMessagesState({ kind: 'idle' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">View transcript</Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-sc-border px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="truncate">{agentName}</span>
            <span className="font-mono text-sm font-medium text-sc-muted-foreground">#{subrunId}</span>
            <span className="flex items-center gap-1 text-sm font-medium capitalize text-sc-muted-foreground">
              <SubagentStatusIcon status={status} />
              {status}
            </span>
          </DialogTitle>
          <DialogDescription>Read-only transcript of this delegated run.</DialogDescription>
          <div className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-xs text-sc-muted-foreground">
            <span>Turns: {turns}{maxTurns ? `/${maxTurns}` : ''}</span>
            <span>Duration: {formatDuration(durationMs)}</span>
            <span>Tokens: {usage?.tokenUsage?.total.toLocaleString() ?? '—'}</span>
          </div>
          {task ? (
            <div className="mt-3 rounded-md bg-sc-muted/50 px-3 py-2 text-xs leading-5 text-sc-foreground">
              <strong>Task:</strong> {task}
              {expectedOutput ? <><br /><strong>Expected:</strong> {expectedOutput}</> : null}
            </div>
          ) : null}
          {deliverables.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-sc-muted-foreground">Deliverables</p>
              <GeneratedFileCards items={deliverables.map((fileUri) => ({ fileUri }))} />
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {messagesState.kind === 'loading' ? (
            <p className="m-0 text-sm text-sc-muted-foreground">Loading transcript…</p>
          ) : null}
          {messagesState.kind === 'error' ? (
            <div className="flex flex-col items-start gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-900">
              <span>Transcript unavailable: {messagesState.message}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setRequestVersion((version) => version + 1)}>Retry</Button>
            </div>
          ) : null}
          {messagesState.kind === 'ready' && messagesState.messages.length === 0 ? (
            <p className="m-0 text-sm text-sc-muted-foreground">No messages were recorded for this run.</p>
          ) : null}
          {messagesState.kind === 'ready' && messagesState.messages.length > 0 ? (
            <div className="flex flex-col gap-3">
              {messagesState.messages.map((message) => <TranscriptMessage key={message.id} message={message} />)}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-sc-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
