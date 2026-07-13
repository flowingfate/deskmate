// src/renderer/components/chat/tool/ToolChip.tsx
// 工具调用胶囊标签 —— 中性主体 + 状态点设计:
//   completed: 中性,无点
//   executing: 琥珀脉动点
//   failed/interrupted: 实心红点
// 选中 = 深色填充(键帽感) + 白字,与未选中拉开强对比。
//
// 默认显示 toolName。工具可通过 ToolRenderer.chipLabel 覆盖文案 —— 此时仍由
// 本组件控制外观/交互/状态点;或通过 ToolRenderer.Chip 覆盖整个组件 ——
// 此时本组件不参与渲染,由 ToolCallsSection 直接调用 override。

import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shadcn/tooltip';
import type { ToolCallExecutionStatus } from './types';

type ChipVisual = 'completed' | 'executing' | 'failed';

export interface ToolChipProps {
  /** 真实 toolName(总是传入,用于 fallback / aria) */
  toolName: string;
  /** 实际展示的文案;由 ToolCallsSection 计算后传入(默认 = toolName)。 */
  label: string;
  status: ToolCallExecutionStatus;
  failed: boolean;
  selected: boolean;
  /** MCP 工具的 server 名称;缺席表示本地工具。MCP chip 以图标 + 紫色表面 + hover tooltip 区分。 */
  mcpServer?: string;
  onClick: () => void;
}

const visualOf = (status: ToolCallExecutionStatus, failed: boolean): ChipVisual => {
  if (status === 'executing') return 'executing';
  if (status === 'interrupted') return 'failed';
  return failed ? 'failed' : 'completed';
};

const CHIP_BASE =
  'inline-flex items-center gap-1.5 h-[21px] px-2 rounded-[5px] ' +
  'text-[11px] leading-none font-medium tracking-tight cursor-pointer ' +
  'ring-1 ring-inset transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-primary-500/70';

// selected = 深色填充,unselected = 浅灰底。bg 区分主色,ring 取比 bg 略深一档勾勒边线。
const CHIP_VARIANT: Record<'unselected' | 'selected', string> = {
  unselected: 'text-gray-700 bg-gray-100 ring-gray-200 hover:bg-gray-200/70 hover:ring-gray-300',
  selected:   'text-white bg-gray-900 ring-black/60 hover:bg-gray-800',
};

const MCP_CHIP_VARIANT: Record<'unselected' | 'selected', string> = {
  unselected: 'text-violet-800 bg-violet-50 ring-violet-200 hover:bg-violet-100 hover:ring-violet-300',
  selected: 'text-white bg-violet-700 ring-violet-800/60 hover:bg-violet-600',
};

const DOT_BASE = 'w-1.5 h-1.5 rounded-full flex-shrink-0';
const DOT_BY_VISUAL: Record<ChipVisual, string | null> = {
  completed: null,
  executing: 'bg-amber-400 motion-safe:animate-pulse',
  failed:    'bg-rose-500',
};


const renderChipLabel = (text: string, selected: boolean): React.ReactNode => {
  const idx = text.indexOf(':');
  // 冒号在首位 / 末位,或冒号后是空格(`shell: cmd`)—— 不上色。
  if (idx <= 0 || idx >= text.length - 1 || text[idx + 1] === ' ') return text;
  return (
    <>
      {text.slice(0, idx + 1)}
      <span className={selected ? 'text-sky-300' : 'text-sky-700'}>
        {text.slice(idx + 1)}
      </span>
    </>
  );
};

export const ToolChip: React.FC<ToolChipProps> = ({
  toolName,
  label,
  status,
  failed,
  selected,
  mcpServer,
  onClick,
}) => {
  const isMcp = mcpServer !== undefined;
  const visual = visualOf(status, failed);
  const dotCls = DOT_BY_VISUAL[visual];
  const display = label || toolName;
  const variant = isMcp ? MCP_CHIP_VARIANT : CHIP_VARIANT;
  const button = (
    <button
      type="button"
      className={`${CHIP_BASE} ${variant[selected ? 'selected' : 'unselected']}`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={isMcp ? `MCP tool: ${toolName} (${mcpServer})` : toolName}
    >
      {dotCls && <span className={`${DOT_BASE} ${dotCls}`} aria-hidden="true" />}
      <span className="truncate max-w-45">{renderChipLabel(display, selected)}</span>
    </button>
  );
  if (!isMcp) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-1 text-[11px]">
        <span>mcp · {mcpServer}</span>
      </TooltipContent>
    </Tooltip>
  );
};

export default ToolChip;
