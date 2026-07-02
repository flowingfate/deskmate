// src/renderer/components/chat/tool/renderers/app/subagent/spawn.tsx
// `app subagent spawn` 子命令的 ToolRenderer 形态实现 —— 单 task 视图。
//
// slot 划分:
//   InputBlock            : sub-agent name + task description + share-context badge
//   OutputExecutingBlock  : 实时进度面板(订阅 subAgent:stateUpdate IPC)
//   OutputSuccessBlock    : 最终 result 文本(LLM 直接看到的产物)
// chip / interrupted / failed 走默认。

import React, { useEffect, useMemo, useState } from 'react';
import type {
  ToolRenderer,
  ToolSlotProps,
  ToolOutputSuccessSlotProps,
} from '../../../types';
import type { SubAgentRuntimeState } from '@shared/types/profileTypes';
import { subAgentEvents } from '@/ipc/subAgent';
import { Badge } from '@/shadcn/badge';
import { parseSpawnArgsForView } from './parse';
import {
  SubAgentStepsList,
  StreamingTextDisplay,
  TurnProgressBar,
  useElapsedTimer,
} from './helpers';

const useSingleAgentRuntime = (
  toolCallId: string,
  hasResponse: boolean,
): SubAgentRuntimeState | null => {
  const [state, setState] = useState<SubAgentRuntimeState | null>(null);
  useEffect(() => {
    if (hasResponse) return;
    return subAgentEvents.stateUpdate((_event, s) => {
      if (s.correlationId === toolCallId) setState(s);
    });
  }, [toolCallId, hasResponse]);
  return state;
};

const InputBlock: React.FC<ToolSlotProps> = ({ toolCall }) => {
  const { sub_agent_name, task, share_context } = useMemo(
    () => parseSpawnArgsForView(toolCall.args),
    [toolCall.args],
  );
  return (
    <div className="flex flex-col gap-1 px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 text-[11.5px]">
      <div className="flex items-center gap-2">
        <span>🤖</span>
        <span className="text-gray-500">Sub-Agent:</span>
        <strong className="font-mono">{sub_agent_name || 'Unknown'}</strong>
      </div>
      <div className="text-gray-700 whitespace-pre-wrap break-words">
        {task || 'No task description'}
      </div>
      {share_context && (
        <Badge className="self-start bg-neutral-50 text-neutral-800 text-[10px]">
          📋 Context shared
        </Badge>
      )}
    </div>
  );
};

const OutputExecutingBlock: React.FC<ToolSlotProps> = ({ toolCall, executionStatus }) => {
  const runtimeState = useSingleAgentRuntime(toolCall.id, !!toolCall.response);
  const isRunning = executionStatus === 'executing';
  const elapsed = useElapsedTimer(runtimeState?.startTime, isRunning);
  const displayText = runtimeState?.streamingText || runtimeState?.lastTextSnippet;
  const isStreaming = !!runtimeState?.streamingText;

  return (
    <div className="px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 border-l-2 border-l-neutral-400">
      <div className="flex items-center gap-2 text-[11px]">
        <Badge className="bg-neutral-50 text-neutral-700">
          {runtimeState
            ? `⏳ Turn ${runtimeState.currentTurn}/${runtimeState.maxTurns}`
            : '⏳ Starting...'}
        </Badge>
        {elapsed && <span className="text-zinc-500 tabular-nums">{elapsed}</span>}
      </div>
      {runtimeState && (
        <>
          <TurnProgressBar current={runtimeState.currentTurn} max={runtimeState.maxTurns} />
          {runtimeState.steps.length > 0 && (
            <div className="mt-2">
              <SubAgentStepsList steps={runtimeState.steps} />
            </div>
          )}
          {displayText &&
            (isStreaming ? (
              <StreamingTextDisplay text={displayText} />
            ) : (
              <div className="mt-1.5 px-2 py-1 text-xs text-zinc-500 whitespace-pre-wrap line-clamp-4 italic leading-relaxed">
                💬 {displayText}
              </div>
            ))}
        </>
      )}
    </div>
  );
};

const OutputSuccessBlock: React.FC<ToolOutputSuccessSlotProps> = ({ result }) => (
  <pre className="m-0 px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 font-mono text-[11.5px] leading-[1.55] text-gray-800 whitespace-pre-wrap break-words max-h-[280px] overflow-auto custom-scrollbar">
    {result}
  </pre>
);

export const subagentSpawnRenderer: ToolRenderer = {
  chipLabel: () => 'app:subagent spawn',
  InputBlock,
  OutputExecutingBlock,
  OutputSuccessBlock,
};
