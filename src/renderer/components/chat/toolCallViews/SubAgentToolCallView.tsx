// src/renderer/components/chat/toolCallViews/SubAgentToolCallView.tsx
// Custom view component for Sub-Agent tool calls — single task + parallel task display
// Real-time progress rendering — subscribes to subAgent:stateUpdate IPC, displays step list + LLM streaming text
//
// Tool 路径:LLM 调 `app("subagent spawn ...")` / `app("subagent spawn-many ...")`,
// `getToolCallView` 走 `resolveAppCmdView` 把 toolCall 派到本文件的两个组件。
// args 形态从老 `{ sub_agent_name, task, share_context }` JSON object 改成
// `{ cmd: string }`,由 `appCmdViewResolver` 的 `parseSpawnArgsForView` /
// `parseSpawnManyArgsForView` 解析回 view 需要的字段。

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { ToolCallViewProps } from './types';
import type { SubAgentRuntimeState, SubAgentStep } from '@shared/types/profileTypes';
import { subAgentEvents } from '@/ipc/subAgent';
import { Badge } from '@/shadcn/badge';
import {
  parseSpawnArgsForView,
  parseSpawnManyArgsForView,
} from './appCmdViewResolver';

/**
 * Format duration to human-readable text
 */
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
};

/**
 * Format character count
 */
const formatSize = (chars: number): string => {
  if (chars < 1000) return `${chars} chars`;
  if (chars < 100000) return `${(chars / 1000).toFixed(1)}K`;
  return `${(chars / 1000).toFixed(0)}K`;
};

// ─────────────────────────────────────────────────────────────────────────────
// ElapsedTimer — Running Timer Hook
// ─────────────────────────────────────────────────────────────────────────────

const useElapsedTimer = (startTime: number | undefined, isRunning: boolean): string => {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isRunning || !startTime) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  if (!startTime) return '';
  const elapsed = Date.now() - startTime;
  return formatDuration(elapsed);
};

// ─────────────────────────────────────────────────────────────────────────────
// TurnProgressBar — Turn Progress Bar
// ─────────────────────────────────────────────────────────────────────────────

const TurnProgressBar: React.FC<{ current: number; max: number }> = ({ current, max }) => {
  const pct = Math.min((current / max) * 100, 100);
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1 rounded-full bg-zinc-700/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-400 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums">
        {current}/{max}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StreamingTextDisplay — LLM Real-time Streaming Text Display
// ─────────────────────────────────────────────────────────────────────────────

const StreamingTextDisplay: React.FC<{ text: string; label?: string }> = ({ text, label = '💭 Thinking' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  if (!text) return null;

  return (
    <div className="mt-1.5 rounded overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-white/2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div
        ref={containerRef}
        className="px-2.5 py-1.5 max-h-[120px] overflow-y-auto text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap scrollbar-thin"
      >
        {text}
        <span className="inline-block w-[2px] h-3.5 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SubAgentStepsList — Sub-Agent Steps List Sub-component (Enhanced)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sub-agent steps list component
 * Displays tool call progress — including tool argument summary, execution duration, result size
 *
 * Note: Backend SubAgentManager handles in-place replacement of tool_start → tool_done/tool_error,
 * so the frontend doesn't need to merge again — just filter and render directly.
 */
const SubAgentStepsList: React.FC<{ steps: SubAgentStep[]; compact?: boolean }> = ({ steps, compact = false }) => {
  // Filter out non-tool type steps
  const toolSteps = useMemo(
    () => steps.filter(s => s.type === 'tool_start' || s.type === 'tool_done' || s.type === 'tool_error'),
    [steps]
  );

  if (toolSteps.length === 0) return null;

  // Compact mode shows only the latest 3
  const visibleSteps = compact ? toolSteps.slice(-3) : toolSteps;
  const hiddenCount = compact ? Math.max(0, toolSteps.length - 3) : 0;

  return (
    <div className="flex flex-col gap-px">
      {hiddenCount > 0 && (
        <div className="text-[10px] text-zinc-600 pl-5 py-0.5">
          ... {hiddenCount} earlier step{hiddenCount > 1 ? 's' : ''}
        </div>
      )}
      {visibleSteps.map((step, idx) => (
        <div key={step.toolCallId || idx} className="flex items-start gap-1.5 text-xs leading-5 py-px group">
          {/* Status icon */}
          <span className="w-4 text-center shrink-0 pt-px">
            {step.type === 'tool_start' && (
              <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-blue-400 border-t-transparent rounded-full animate-spin" />
            )}
            {step.type === 'tool_done' && <span className="text-emerald-500 text-[11px]">✓</span>}
            {step.type === 'tool_error' && <span className="text-red-400 text-[11px]">✗</span>}
          </span>

          {/* Tool name + args summary */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-zinc-400 truncate max-w-[160px]">
                {step.toolName}
              </span>
              {step.type === 'tool_start' && (
                <span className="text-zinc-600 text-[10px] animate-pulse">running...</span>
              )}
              {step.type === 'tool_done' && step.durationMs != null && (
                <span className="text-zinc-600 text-[10px]">{formatDuration(step.durationMs)}</span>
              )}
              {step.type === 'tool_done' && step.toolResultLength != null && (
                <span className="text-zinc-600 text-[10px]">→ {formatSize(step.toolResultLength)}</span>
              )}
              {step.type === 'tool_error' && (
                <span className="text-red-400/80 text-[10px]">failed</span>
              )}
            </div>
            {/* Tool args summary - show on hover or always in non-compact mode */}
            {step.toolArgsSummary && !compact && (
              <div className="text-[10px] text-zinc-600 truncate mt-px leading-4">
                {step.toolArgsSummary}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SubAgentToolCallView — Single Task Display Component (with real-time progress + LLM streaming)
// ─────────────────────────────────────────────────────────────────────────────

export const SubAgentToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  executionStatus,
}) => {
  // Step 1: Parse cmdline-shaped args via shared resolver helper.
  const { sub_agent_name: subAgentName, task, share_context: shareContext } = useMemo(
    () => parseSpawnArgsForView(toolCall.args),
    [toolCall.args],
  );
  // 老 view 在 name 缺失时回落到 "Unknown",task 缺失时 "No task description";
  // parseSpawnArgsForView 缺失返回空串,这里保留 fallback 文案。
  const displayName = subAgentName || 'Unknown';
  const displayTask = task || 'No task description';

  // Domain ToolCall.response 是结构化对象;result text 即工具输出。
  const toolResponse = toolCall.response;
  const resultText = toolResponse?.result ?? null;

  // Step 2: Real-time progress state
  const [runtimeState, setRuntimeState] = useState<SubAgentRuntimeState | null>(null);

  // Step 3: Remember final status (for accurate success/failure detection, replacing fragile string matching)
  const [finalStatus, setFinalStatus] = useState<'completed' | 'failed' | 'cancelled' | null>(null);

  // Step 4: Subscribe to subAgent:stateUpdate IPC, using toolCall.id as correlationId for precise matching
  useEffect(() => {
    if (toolResponse) return;

    const cleanup = subAgentEvents.stateUpdate((_event, state) => {
      if (state.correlationId === toolCall.id) {
        setRuntimeState(state);
        if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
          setFinalStatus(state.status);
        }
      }
    });

    return cleanup;
  }, [toolCall.id, toolResponse]);

  // Step 5: Clear real-time state after tool execution completes
  useEffect(() => {
    if (toolResponse) {
      setRuntimeState(null);
    }
  }, [toolResponse]);


  // Step 7: Determine execution status
  const isRunning = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';
  // Domain `response.status === 'fail'` 是权威 fail 判定;runtimeState 的 finalStatus
  // 仅作 in-flight 时的早期信号。
  const responseStatus = toolResponse?.status;
  const isSuccess =
    finalStatus === 'completed' ||
    (responseStatus === 'success' && finalStatus === null) ||
    (resultText !== null && finalStatus === null && responseStatus !== 'fail');
  const isError =
    finalStatus === 'failed' || finalStatus === 'cancelled' || responseStatus === 'fail';

  // Step 8: Running timer
  const elapsed = useElapsedTimer(runtimeState?.startTime, isRunning);

  // Step 9: Check if any tool is currently running (steps contain tool_start type)
  const hasRunningTool = useMemo(
    () => runtimeState?.steps?.some(s => s.type === 'tool_start') ?? false,
    [runtimeState?.steps]
  );

  // Step 10: Decide whether to show streamingText or lastTextSnippet
  const displayText = runtimeState?.streamingText || runtimeState?.lastTextSnippet;
  const isStreaming = !!runtimeState?.streamingText;

  return (
    <div className="sub-agent-tool-call-view">
      {/* Header — Display turn progress + timer */}
      <div className="sub-agent-tool-header">
        <span className="sub-agent-tool-icon">🤖</span>
        <span className="sub-agent-tool-label">
          Sub-Agent: <strong>{displayName}</strong>
        </span>
        {isRunning && elapsed && (
          <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">{elapsed}</span>
        )}
        <Badge className={`sub-agent-status-badge ${isRunning ? 'running' : isSuccess ? 'success' : 'error'}`}>
          {isRunning
            ? runtimeState
              ? `⏳ Turn ${runtimeState.currentTurn}/${runtimeState.maxTurns}`
              : '⏳ Starting...'
            : isInterrupted
              ? '⚠ Interrupted'
              : isSuccess
              ? '✅ Done'
              : '❌ Failed'}
        </Badge>
      </div>

      {/* Task Description */}
      <div className="sub-agent-tool-task">
        <span className="sub-agent-task-label">Task:</span>
        <span className="sub-agent-task-text">{displayTask}</span>
      </div>

      {/* Context Badge */}
      {shareContext && (
        <Badge className="border-0 px-3 py-1.5 bg-blue-50 text-blue-800 rounded-lg w-full justify-start">
          📋 Context shared with sub-agent
        </Badge>
      )}

      {/* Real-time progress area */}
      {isRunning && runtimeState && (
        <div className="px-3 py-2 bg-white/3 border-l-2 border-blue-400 border-b border-b-(--border-color,#e5e7eb)">
          {/* Turn progress bar */}
          <TurnProgressBar current={runtimeState.currentTurn} max={runtimeState.maxTurns} />

          {/* Tool call list */}
          {runtimeState.steps.length > 0 && (
            <div className="mt-2">
              <SubAgentStepsList steps={runtimeState.steps} />
            </div>
          )}

          {/* LLM real-time streaming text or recent text snippet */}
          {displayText && (
            isStreaming
              ? <StreamingTextDisplay text={displayText} />
              : (
                <div className="mt-1.5 px-2 py-1 text-xs text-zinc-400 whitespace-pre-wrap line-clamp-4 italic leading-relaxed">
                  💬 {displayText}
                </div>
              )
          )}
        </div>
      )}

      {/* Result */}
      {resultText && (
        <div className="sub-agent-tool-result">
          <div className="sub-agent-result-divider">Result</div>
          <div className="sub-agent-result-content">
            <pre className="sub-agent-result-pre">{resultText}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ParallelSubAgentsToolCallView — Parallel Task Display Component (with real-time progress)
// ─────────────────────────────────────────────────────────────────────────────

export const ParallelSubAgentsToolCallView: React.FC<ToolCallViewProps> = ({
  toolCall,
  executionStatus,
}) => {
  // Step 1: Parse cmdline-shaped args via shared resolver helper.
  const { tasks } = useMemo(
    () => parseSpawnManyArgsForView(toolCall.args),
    [toolCall.args],
  );

  const toolResponse = toolCall.response;

  // Step 2: Real-time progress state — indexed by correlationId
  const [stateMap, setStateMap] = useState<Map<string, SubAgentRuntimeState>>(new Map());

  useEffect(() => {
    if (toolResponse) return;

    const cleanup = subAgentEvents.stateUpdate((_event, state) => {
      if (state.correlationId?.startsWith(toolCall.id + '_')) {
        setStateMap(prev => {
          const next = new Map(prev);
          next.set(state.correlationId!, state);
          return next;
        });
      }
    });

    return cleanup;
  }, [toolCall.id, toolResponse]);

  // Step 3: Parse parallel results
  const resultText = useMemo(() => toolResponse?.result ?? null, [toolResponse]);

  // Step 4: Split result text into individual task results by "### Task N:" headers
  const taskResults = useMemo(() => {
    if (!resultText) return [];
    const taskHeaderRegex = /### Task \d+:/g;
    const indices: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = taskHeaderRegex.exec(resultText)) !== null) {
      indices.push(match.index);
    }
    if (indices.length === 0) return [];
    return indices.map((start, i) => {
      const end = i + 1 < indices.length ? indices[i + 1] : resultText.length;
      const section = resultText.slice(start, end).replace(/\n{1,2}---\s*$/, '').trim();
      const statusMatch = section.match(/\*\*Status\*\*:\s*(.*)/);
      const durationMatch = section.match(/\*\*Duration\*\*:\s*(\d+)ms/);
      return {
        text: section,
        isSuccess: statusMatch?.[1]?.includes('Completed') ?? false,
        durationMs: durationMatch ? parseInt(durationMatch[1]) : undefined,
      };
    });
  }, [resultText]);

  const isRunning = executionStatus === 'executing';
  const isInterrupted = executionStatus === 'interrupted';

  // Step 5: Count completed tasks
  const completedCount = useMemo(() => {
    let count = 0;
    stateMap.forEach(s => {
      if (s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled') count++;
    });
    return count;
  }, [stateMap]);

  return (
    <div className="parallel-sub-agents-tool-call-view">
      {/* Header */}
      <div className="sub-agent-tool-header">
        <span className="sub-agent-tool-icon">🤖</span>
        <span className="sub-agent-tool-label">
          Parallel Sub-Agents ({tasks.length} tasks)
        </span>
        <Badge className={`sub-agent-status-badge ${isRunning ? 'running' : 'done'}`}>
          {isRunning
            ? stateMap.size > 0
              ? `⏳ ${completedCount}/${tasks.length} done`
              : '⏳ Starting...'
            : isInterrupted
              ? '⚠ Interrupted'
              : '✅ All Done'}
        </Badge>
      </div>

      {/* Task Cards */}
      <div className="parallel-tasks-list">
        {tasks.map((task, index) => {
          const correlationId = `${toolCall.id}_${index}`;
          const taskState = stateMap.get(correlationId);
          const taskResult = taskResults[index];
          const displayText = taskState?.streamingText || taskState?.lastTextSnippet;
          const isTaskStreaming = !!taskState?.streamingText;

          return (
            <div key={index} className="parallel-task-card">
              <div className="parallel-task-header">
                <strong>{task.sub_agent_name}</strong>
                {taskResult && (
                  <span className={`parallel-task-status ${taskResult.isSuccess ? 'success' : 'error'}`}>
                    {taskResult.isSuccess ? '✅' : '❌'}
                    {taskResult.durationMs && ` ${formatDuration(taskResult.durationMs)}`}
                  </span>
                )}
                {!taskResult && isRunning && (
                  <span className="parallel-task-status running">
                    {taskState
                      ? `⏳ Turn ${taskState.currentTurn}/${taskState.maxTurns}`
                      : '⏳'}
                  </span>
                )}
              </div>
              <div className="parallel-task-description">{task.task}</div>

              {/* Progress bar + step list + LLM streaming text */}
              {isRunning && taskState && (
                <div className="mt-1.5 px-2 py-1.5 bg-white/3 rounded border-l-2 border-blue-400">
                  <TurnProgressBar current={taskState.currentTurn} max={taskState.maxTurns} />
                  {taskState.steps.length > 0 && (
                    <div className="mt-1">
                      <SubAgentStepsList steps={taskState.steps} compact />
                    </div>
                  )}
                  {displayText && (
                    isTaskStreaming
                      ? <StreamingTextDisplay text={displayText} />
                      : (
                        <div className="mt-1 text-[11px] text-zinc-400 line-clamp-2 italic leading-relaxed">
                          💬 {displayText}
                        </div>
                      )
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Combined Results (collapsible) */}
      {resultText && (
        <details className="parallel-results-details">
          <summary>View detailed results</summary>
          <div className="parallel-results-content">
            <pre className="sub-agent-result-pre">{resultText}</pre>
          </div>
        </details>
      )}
    </div>
  );
};

export default SubAgentToolCallView;
