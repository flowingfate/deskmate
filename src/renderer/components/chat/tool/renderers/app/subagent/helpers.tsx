// src/renderer/components/chat/tool/renderers/app/subagent/helpers.tsx
// SubAgent slot 实现的共享小组件 / hook —— ElapsedTimer / TurnProgressBar /
// StreamingTextDisplay / SubAgentStepsList。单 task 与并行 task 视图共用。

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { SubAgentStep } from '@shared/types/profileTypes';

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
};

export const formatSize = (chars: number): string => {
  if (chars < 1000) return `${chars} chars`;
  if (chars < 100000) return `${(chars / 1000).toFixed(1)}K`;
  return `${(chars / 1000).toFixed(0)}K`;
};

export const useElapsedTimer = (
  startTime: number | undefined,
  isRunning: boolean,
): string => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isRunning || !startTime) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning, startTime]);
  if (!startTime) return '';
  return formatDuration(Date.now() - startTime);
};

export const TurnProgressBar: React.FC<{ current: number; max: number }> = ({
  current,
  max,
}) => {
  const pct = Math.min((current / max) * 100, 100);
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1 rounded-full bg-zinc-700/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-neutral-400 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums">
        {current}/{max}
      </span>
    </div>
  );
};

export const StreamingTextDisplay: React.FC<{ text: string; label?: string }> = ({
  text,
  label = '💭 Thinking',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);
  if (!text) return null;
  return (
    <div className="mt-1.5 rounded overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 bg-white/2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div
        ref={containerRef}
        className="px-2.5 py-1.5 max-h-[120px] overflow-y-auto text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap scrollbar-thin"
      >
        {text}
        <span className="inline-block w-[2px] h-3.5 bg-neutral-400 animate-pulse ml-0.5 align-text-bottom" />
      </div>
    </div>
  );
};

/**
 * Sub-agent steps list —— filter to tool_start / tool_done / tool_error,展示 tool
 * name + duration + result size。Backend SubAgentManager 已经把 tool_start
 * in-place 替换为 tool_done/tool_error,前端不需要再 merge。
 */
export const SubAgentStepsList: React.FC<{ steps: SubAgentStep[]; compact?: boolean }> = ({
  steps,
  compact = false,
}) => {
  const toolSteps = useMemo(
    () =>
      steps.filter(
        s => s.type === 'tool_start' || s.type === 'tool_done' || s.type === 'tool_error',
      ),
    [steps],
  );
  if (toolSteps.length === 0) return null;
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
        <div
          key={step.toolCallId || idx}
          className="flex items-start gap-1.5 text-xs leading-5 py-px group"
        >
          <span className="w-4 text-center shrink-0 pt-px">
            {step.type === 'tool_start' && (
              <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-neutral-400 border-t-transparent rounded-full animate-spin" />
            )}
            {step.type === 'tool_done' && (
              <span className="text-emerald-500 text-[11px]">✓</span>
            )}
            {step.type === 'tool_error' && (
              <span className="text-red-400 text-[11px]">✗</span>
            )}
          </span>
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
                <span className="text-zinc-600 text-[10px]">
                  → {formatSize(step.toolResultLength)}
                </span>
              )}
              {step.type === 'tool_error' && (
                <span className="text-red-400/80 text-[10px]">failed</span>
              )}
            </div>
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
