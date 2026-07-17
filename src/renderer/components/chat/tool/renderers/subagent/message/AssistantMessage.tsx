import { useState } from 'react';
import type { Message, ToolCall } from '@shared/persist/types';
import { MarkdownView } from '../../../../message/MarkdownView';
import { ToolChip } from '../../../ToolChip';
import { ToolDetailView } from '../../../ToolDetailView';
import type { ToolCallExecutionStatus } from '../../../types';
import { EmptyMessageNotice, MessageCard } from './MessageCard';
import { Wrench } from 'lucide-react';

type AssistantTranscriptMessage = Extract<Message, { role: 'assistant' }>;

function getToolCallStatus(toolCall: ToolCall): ToolCallExecutionStatus {
  return toolCall.response ? 'completed' : 'interrupted';
}

interface AssistantToolCallsProps {
  message: AssistantTranscriptMessage;
}

function AssistantToolCalls({ message }: AssistantToolCallsProps) {
  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null);
  const selectedToolCall = message.tool_calls.find((toolCall) => toolCall.id === selectedToolCallId);

  if (message.tool_calls.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5 items-center border border-black/7 bg-black/2 rounded p-1" aria-label="Tool calls">
        <Wrench size={12} />
        <span className="text-sm font-medium text-sc-muted-foreground">TOOL </span>
        {message.tool_calls.map((toolCall) => (
          <ToolChip
            key={toolCall.id}
            toolName={toolCall.name}
            label={toolCall.name}
            status={getToolCallStatus(toolCall)}
            failed={toolCall.response?.status === 'fail'}
            selected={toolCall.id === selectedToolCallId}
            mcpServer={toolCall.mcp}
            onClick={() => {
              setSelectedToolCallId((currentId) => currentId === toolCall.id ? null : toolCall.id);
            }}
          />
        ))}
      </div>
      {selectedToolCall ? (
        <div className="mt-2 rounded-md border border-black/8 bg-white p-3">
          <ToolDetailView
            toolCall={selectedToolCall}
            executionStatus={getToolCallStatus(selectedToolCall)}
            renderer={null}
          />
        </div>
      ) : null}
    </div>
  );
}

interface AssistantMessageProps {
  message: AssistantTranscriptMessage;
}

export function AssistantMessage({ message }: AssistantMessageProps) {
  const hasContent = message.content.trim().length > 0;
  const hasToolCalls = message.tool_calls.length > 0;

  return (
    <MessageCard label="Delegated Agent" time={message.time} tone="assistant">
      {hasContent ? <MarkdownView text={message.content} /> : null}
      <AssistantToolCalls message={message} />
      {!hasContent && !hasToolCalls ? <EmptyMessageNotice /> : null}
    </MessageCard>
  );
}
