// ToolCallsSection — 工具调用章节,collapsed(chip 卡片) / expanded(view all) 两种视图。
// 外壳几何由 SCSS data-mode 选择器驱动(ChatContainer.scss),高度 + 滚动锚定由 AnimatedHeight 统一。

import React, { useCallback, useState } from 'react';
import { Wrench, ChevronRight, X } from 'lucide-react';
import type { ToolCall } from '@shared/types/message';
import { AnimatedHeight } from './AnimatedHeight';
import { ToolChip } from './ToolChip';
import { ToolDetailView } from './ToolDetailView';
import { resolveToolRenderer } from './toolRendererRegistry';
import type { ToolCallExecutionStatus, ToolRenderer } from './types';

export interface ToolCallsSectionProps {
  toolCalls: ToolCall[];
  sectionKey: string;
  /**
   * section 是否仍可能接收新的 tool response。
   * 由 ChatContainer 计算(末位 tool-section ∧ chat 非 idle)。
   * false ⇒ 仍 pending 的 tool 视为 interrupted。
   */
  isLive: boolean;
}

type Mode = 'collapsed' | 'expanded';

const computeExecutionStatus = (
  toolCall: ToolCall,
  isLive: boolean,
): ToolCallExecutionStatus => {
  if (toolCall.response) return 'completed';
  return isLive ? 'executing' : 'interrupted';
};

// Root

export const ToolCallsSection: React.FC<ToolCallsSectionProps> = ({
  toolCalls,
  sectionKey,
  isLive,
}) => {
  const validToolCalls = toolCalls.filter(
    (tc) => tc.id.trim() !== '' && tc.name.trim() !== '',
  );

  const [mode, setMode] = useState<Mode>('collapsed');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleChipClick = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);
  const handleExpand = useCallback(() => setMode('expanded'), []);
  const handleCollapse = useCallback(() => setMode('collapsed'), []);

  if (validToolCalls.length === 0) return null;

  return (
    <AnimatedHeight
      duration={220}
      className="tool-calls-section min-w-0 mb-3 flex flex-col items-stretch motion-reduce:transition-none"
      data-section-key={sectionKey}
      data-mode={mode}
      isLive={isLive}
    >
      {mode === 'expanded' ? (
        <ExpandedView
          toolCalls={validToolCalls}
          isLive={isLive}
          onCollapse={handleCollapse}
        />
      ) : (
        <CollapsedView
          toolCalls={validToolCalls}
          isLive={isLive}
          selectedId={selectedId}
          onSelect={handleChipClick}
          onExpand={handleExpand}
        />
      )}
    </AnimatedHeight>
  );
};


interface CollapsedViewProps {
  toolCalls: ToolCall[];
  isLive: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExpand: () => void;
}

const CollapsedView: React.FC<CollapsedViewProps> = ({
  toolCalls,
  isLive,
  selectedId,
  onSelect,
  onExpand,
}) => {
  const selected = selectedId
    ? toolCalls.find((tc) => tc.id === selectedId) ?? null
    : null;

  return (
    <>
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.09em] uppercase text-gray-400">
          <Wrench size={11} aria-hidden="true" strokeWidth={2} className="text-neutral-500" />
          <span>Tool</span>
        </div>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {toolCalls.map((tc) => {
            const status = computeExecutionStatus(tc, isLive);
            const renderer = resolveToolRenderer(tc.name);
            return (
              <ChipSlot
                key={tc.id}
                toolCall={tc}
                status={status}
                renderer={renderer}
                selected={selectedId === tc.id}
                onClick={() => onSelect(tc.id)}
              />
            );
          })}
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex items-center gap-0.5 bg-transparent border-none p-0 text-[10.5px] font-medium tracking-[0.04em] text-gray-400/80 cursor-pointer transition-colors duration-150 hover:text-gray-600"
          aria-label="View all tool calls"
        >
          <span>all</span>
          <ChevronRight size={11} aria-hidden="true" />
        </button>
      </div>

      {/* detail 不自带 AnimatedHeight — 高度变化由根那层统一动画 */}
      {selected && (
        <div className="pt-1.5">
          <ToolDetailView
            toolCall={selected}
            executionStatus={computeExecutionStatus(selected, isLive)}
            renderer={resolveToolRenderer(selected.name)}
          />
        </div>
      )}
    </>
  );
};


interface ExpandedViewProps {
  toolCalls: ToolCall[];
  isLive: boolean;
  onCollapse: () => void;
}

const ExpandedView: React.FC<ExpandedViewProps> = ({ toolCalls, isLive, onCollapse }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-1 px-0.5">
        <div className="flex items-center gap-1 text-[10.5px] font-semibold tracking-[0.09em] uppercase text-gray-400">
          <Wrench size={11} aria-hidden="true" strokeWidth={2} className="text-neutral-500" />
          <span>Tool Calls</span>
          <span className="ml-1 text-gray-400/70 tracking-normal normal-case">
            ({toolCalls.length})
          </span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="inline-flex items-center justify-center w-5 h-5 rounded bg-transparent border-none p-0 text-gray-400/80 cursor-pointer transition-colors duration-150 hover:text-gray-700 hover:bg-gray-200/60"
          aria-label="Collapse tool calls"
          title="Collapse"
        >
          <X size={12} aria-hidden="true" strokeWidth={2} />
        </button>
      </div>

      <ul className="list-none m-0 p-0 pr-2 flex flex-col gap-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
        {toolCalls.map((tc) => {
          const status = computeExecutionStatus(tc, isLive);
          const renderer = resolveToolRenderer(tc.name);
          return (
            <li
              key={tc.id}
              className="rounded-md ring-1 ring-inset ring-gray-200/60 bg-white px-2.5 py-2 flex flex-col gap-2"
            >
              <ToolCardHeader toolCall={tc} status={status} renderer={renderer} />
              <ToolDetailView
                toolCall={tc}
                executionStatus={status}
                renderer={renderer}
                verticallyUnbounded
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// 子组件

const ToolCardHeader: React.FC<{
  toolCall: ToolCall;
  status: ToolCallExecutionStatus;
  renderer: ToolRenderer | null;
}> = ({ toolCall, status, renderer }) => {
  const failed = toolCall.response?.status === 'fail';
  const label = renderer?.chipLabel ? renderer.chipLabel(toolCall) : '';
  const display = label || toolCall.name;
  return (
    <header className="flex items-center gap-1.5 min-w-0">
      <StatusDot status={status} failed={failed} />
      <span
        className="text-[12px] font-medium text-gray-700 truncate min-w-0 flex-1"
        title={toolCall.name}
      >
        {display}
      </span>
    </header>
  );
};

const StatusDot: React.FC<{ status: ToolCallExecutionStatus; failed: boolean }> = ({
  status,
  failed,
}) => {
  // executing: amber pulse / interrupted | failed: rose / completed: subtle emerald
  let cls: string;
  if (status === 'executing') cls = 'bg-amber-400 motion-safe:animate-pulse';
  else if (status === 'interrupted' || failed) cls = 'bg-rose-500';
  else cls = 'bg-emerald-500/70';
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} aria-hidden="true" />;
};

interface ChipSlotProps {
  toolCall: ToolCall;
  status: ToolCallExecutionStatus;
  renderer: ToolRenderer | null;
  selected: boolean;
  onClick: () => void;
}

/** Chip dispatch:粗(Chip)优先;否则默认 ToolChip + label override。 */
const ChipSlot: React.FC<ChipSlotProps> = ({ toolCall, status, renderer, selected, onClick }) => {
  const failed = toolCall.response?.status === 'fail';
  if (renderer?.Chip) {
    const Chip = renderer.Chip;
    return (
      <Chip
        toolCall={toolCall}
        executionStatus={status}
        selected={selected}
        failed={failed}
        onClick={onClick}
      />
    );
  }
  const label = renderer?.chipLabel ? renderer.chipLabel(toolCall) : '';
  return (
    <ToolChip
      toolName={toolCall.name}
      label={label || toolCall.name}
      status={status}
      failed={failed}
      selected={selected}
      onClick={onClick}
    />
  );
};

export default ToolCallsSection;
