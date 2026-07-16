import React from 'react';
import { Bot } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shadcn/tooltip';
import type {
  ToolChipSlotProps,
  ToolOutputSuccessSlotProps,
  ToolRenderer,
  ToolSlotProps,
} from '../../types';
import { SubagentRunCard } from './RunCard';
import {
  isReadOnlySubagentCommandResult,
  parseSubagentCommandOutcome,
} from './parse';


const SubagentChip: React.FC<ToolChipSlotProps> = ({
  toolCall,
  executionStatus,
  failed,
  selected,
  onClick,
}) => {
  let statusDot: string | null = null;
  if (executionStatus === 'executing') {
    statusDot = 'bg-amber-400 motion-safe:animate-pulse';
  } else if (executionStatus === 'interrupted' || failed) {
    statusDot = 'bg-rose-500';
  }
  const command = typeof toolCall.args.cmd === 'string' ? toolCall.args.cmd.trim() : '';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-5.25 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium leading-none tracking-tight ring-1 ring-inset transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-indigo-500/70 ${selected ? 'bg-indigo-700 text-white ring-indigo-800/60 hover:bg-indigo-600' : 'bg-indigo-50 text-indigo-800 ring-indigo-200 hover:bg-indigo-100 hover:ring-indigo-300'}`}
          onClick={onClick}
          aria-pressed={selected}
          aria-label="Delegated Agent tool"
        >
          <Bot size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          {statusDot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} aria-hidden="true" />}
          <span className="max-w-45 truncate">subagent</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-96 text-[11px]">
        <div className="flex flex-col gap-1">
          <span className="font-medium">Delegated</span>
          <span className="wrap-break-word text-muted-foreground">{command || 'Delegate a task to an allowed Agent.'}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};

const inputArgsText = (toolCall: ToolSlotProps['toolCall']): string => {
  const cmd = toolCall.args.cmd;
  return typeof cmd === 'string' ? cmd : '';
};

const OutputExecutingBlock: React.FC<ToolSlotProps> = ({ toolCall }) => (
  <SubagentRunCard toolCall={toolCall} />
);

const OutputSuccessBlock: React.FC<ToolOutputSuccessSlotProps> = ({ toolCall, result }) => {
  const outcome = parseSubagentCommandOutcome(result);
  if (outcome?.kind === 'rejected') {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900">
        Delegation rejected: {outcome.error}
      </div>
    );
  }
  if (outcome?.kind === 'result') {
    return <SubagentRunCard toolCall={toolCall} result={outcome.result} />;
  }
  if (isReadOnlySubagentCommandResult(result)) {
    return <pre className="m-0 rounded-[4px] border border-black/7 bg-gray-50 px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] text-gray-800 whitespace-pre-wrap wrap-break-word">{result}</pre>;
  }
  return <pre className="m-0 rounded-[4px] border border-black/7 bg-gray-50 px-2.5 py-2 font-mono text-[11.5px] leading-[1.55] text-gray-800 whitespace-pre-wrap wrap-break-word">{result}</pre>;
};

export const subagentRenderer: ToolRenderer = {
  chipLabel: () => 'subagent',
  inputArgsText,
  OutputExecutingBlock,
  OutputSuccessBlock,
  Chip: SubagentChip,
};
