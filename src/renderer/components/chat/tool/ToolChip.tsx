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

const DOT_BASE = 'w-1.5 h-1.5 rounded-full flex-shrink-0';
const DOT_BY_VISUAL: Record<ChipVisual, string | null> = {
  completed: null,
  executing: 'bg-amber-400 motion-safe:animate-pulse',
  failed:    'bg-rose-500',
};

// `namespace:sub` 形态(冒号后紧跟非空白,如 app:subagent / web:search)——
// 给冒号后的子命令上一档 accent 色,与前缀命名空间拉开层次。shell 用的
// `shell: cmd`(冒号后有空格)不命中,保持中性。accent 需在浅灰底(未选中)
// 与 gray-900 深底(选中)两态都可读,故按 selected 切深浅。
const ACCENT_BY_STATE: Record<'unselected' | 'selected', string> = {
  unselected: 'text-sky-600',
  selected:   'text-sky-300',
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
  onClick,
}) => {
  const visual = visualOf(status, failed);
  const dotCls = DOT_BY_VISUAL[visual];
  const display = label || toolName;
  return (
    <button
      type="button"
      className={`${CHIP_BASE} ${CHIP_VARIANT[selected ? 'selected' : 'unselected']}`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={toolName}
    >
      {dotCls && <span className={`${DOT_BASE} ${dotCls}`} aria-hidden="true" />}
      <span className="truncate max-w-45">{renderChipLabel(display, selected)}</span>
    </button>
  );
};

export default ToolChip;
