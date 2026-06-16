// src/renderer/components/chat/tool/renderers/app/subagent/spawnMany.tsx
// `app subagent spawn-many` 子命令的 ToolRenderer 形态实现 —— 并行 task 视图。
//
// slot 划分:
//   InputBlock            : task 列表(name + task description)
//   OutputExecutingBlock  : 各 task 的实时进度卡片(订阅 subAgent:stateUpdate)
//   OutputSuccessBlock    : 合并后的最终 result 文本

import React, { useEffect, useMemo, useState } from 'react';
import type {
  ToolRenderer,
  ToolSlotProps,
  ToolOutputSuccessSlotProps,
} from '../../../types';
import type { SubAgentRuntimeState } from '@shared/types/profileTypes';
import { subAgentEvents } from '@/ipc/subAgent';
import { Badge } from '@/shadcn/badge';
import { parseSpawnManyArgsForView } from './parse';
import {
  SubAgentStepsList,
  StreamingTextDisplay,
  TurnProgressBar,
} from './helpers';

const useParallelAgentRuntime = (
  toolCallId: string,
  hasResponse: boolean,
): Map<string, SubAgentRuntimeState> => {
  const [stateMap, setStateMap] = useState<Map<string, SubAgentRuntimeState>>(new Map());
  useEffect(() => {
    if (hasResponse) return;
    return subAgentEvents.stateUpdate((_event, s) => {
      if (s.correlationId?.startsWith(toolCallId + '_')) {
        setStateMap(prev => {
          const next = new Map(prev);
          next.set(s.correlationId!, s);
          return next;
        });
      }
    });
  }, [toolCallId, hasResponse]);
  return stateMap;
};

const InputBlock: React.FC<ToolSlotProps> = ({ toolCall }) => {
  const { tasks } = useMemo(() => parseSpawnManyArgsForView(toolCall.args), [toolCall.args]);
  return (
    <div className="flex flex-col gap-1.5 px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 text-[11.5px]">
      <div className="flex items-center gap-2">
        <span>🤖</span>
        <span className="text-gray-500">Parallel Sub-Agents:</span>
        <strong>{tasks.length} tasks</strong>
      </div>
      <ul className="m-0 pl-4 list-disc text-gray-700">
        {tasks.map((t, i) => (
          <li key={i} className="leading-relaxed">
            <strong className="font-mono">{t.sub_agent_name}</strong>
            <span className="text-gray-500"> — </span>
            <span className="break-words">{t.task}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const OutputExecutingBlock: React.FC<ToolSlotProps> = ({ toolCall }) => {
  const { tasks } = useMemo(() => parseSpawnManyArgsForView(toolCall.args), [toolCall.args]);
  const stateMap = useParallelAgentRuntime(toolCall.id, !!toolCall.response);
  const completedCount = useMemo(() => {
    let count = 0;
    stateMap.forEach(s => {
      if (s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled') count++;
    });
    return count;
  }, [stateMap]);

  return (
    <div className="flex flex-col gap-1.5">
      <Badge className="self-start bg-blue-50 text-blue-700 text-[11px]">
        {stateMap.size > 0 ? `⏳ ${completedCount}/${tasks.length} done` : '⏳ Starting...'}
      </Badge>
      <div className="flex flex-col gap-1.5">
        {tasks.map((task, index) => {
          const correlationId = `${toolCall.id}_${index}`;
          const taskState = stateMap.get(correlationId);
          const displayText = taskState?.streamingText || taskState?.lastTextSnippet;
          const isTaskStreaming = !!taskState?.streamingText;
          return (
            <div
              key={index}
              className="px-2 py-1.5 rounded bg-gray-50 border-1 border-black/7 border-l-2 border-l-blue-400 text-[11px]"
            >
              <div className="flex items-center gap-1.5">
                <strong className="font-mono">{task.sub_agent_name}</strong>
                {taskState && (
                  <span className="text-zinc-500">
                    Turn {taskState.currentTurn}/{taskState.maxTurns}
                  </span>
                )}
              </div>
              <div className="text-gray-600 line-clamp-1">{task.task}</div>
              {taskState && (
                <>
                  <TurnProgressBar current={taskState.currentTurn} max={taskState.maxTurns} />
                  {taskState.steps.length > 0 && (
                    <div className="mt-1">
                      <SubAgentStepsList steps={taskState.steps} compact />
                    </div>
                  )}
                  {displayText &&
                    (isTaskStreaming ? (
                      <StreamingTextDisplay text={displayText} />
                    ) : (
                      <div className="mt-1 text-[10px] text-zinc-500 line-clamp-2 italic leading-relaxed">
                        💬 {displayText}
                      </div>
                    ))}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const OutputSuccessBlock: React.FC<ToolOutputSuccessSlotProps> = ({ result }) => (
  <pre className="m-0 px-2.5 py-2 rounded-[4px] bg-gray-50 border-1 border-black/7 font-mono text-[11.5px] leading-[1.55] text-gray-800 whitespace-pre-wrap break-words max-h-[320px] overflow-auto custom-scrollbar">
    {result}
  </pre>
);

export const subagentSpawnManyRenderer: ToolRenderer = {
  chipLabel: () => 'app:subagent spawn-many',
  InputBlock,
  OutputExecutingBlock,
  OutputSuccessBlock,
};
