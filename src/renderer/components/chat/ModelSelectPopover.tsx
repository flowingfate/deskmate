/**
 * 模型选择「外壳」组件：Popover + 触发按钮 + label/chevron 展示 + 选中关闭。
 *
 * 五处模型选择点（ChatInput.ModelSelector、SubAgentModelSelect、DoctorModelField、
 * CreateCustomAgentViewContent、AgentBasicTab）此前各自手写这套外壳，仅底层
 * GroupedModelPicker 复用。本组件把外壳收敛为单点：
 *
 * - `open` state、`useModelDisplayLabel`、chevron 旋转、选中后 onChange+关闭 都在此内置。
 * - 各调用点的 domain 逻辑（异步 IPC 落库、localStorage 持久化、Inherit 哨兵项）
 *   不进本组件，仍留在调用点，通过 props 注入：
 *   - `onChange`：调用点自己决定选中后做什么（写 atom / 存 localStorage / 上抛表单）。
 *   - `header`：picker 上方插槽（SubAgent 的 Inherit 选项）。
 *   - `labelOverride` / `invalidOverride`：覆盖按钮上的展示（SubAgent 哨兵态）。
 *
 * 触发按钮外观由 `appearance` 预设：
 * - 'compact'：chat-input 紧凑 pill（outline + size sm，无前导图标；invalid 走琥珀边框）。
 * - 'ghost'：SubAgent 的 `.model-button` ghost 样式（无前导图标）。
 * - 'field'：表单全宽字段（前导 Cpu 图标；invalid 换 AlertTriangle）。
 */

import React, { useState } from 'react';
import { Cpu, ChevronDown, AlertTriangle } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/shadcn/popover';
import { Button } from '@/shadcn/button';
import { cn } from '@/lib/utilities/utils';
import { GroupedModelPicker, useModelDisplayLabel } from './GroupedModelPicker';


interface Props {
  /** 当前选中的 `${provider}::${modelId}`；空串/无效视为未选 */
  value: string;
  /** 选中某个模型后回调；组件已在其后自动关闭 popover */
  onChange: (composite: string) => void;
  /** 触发按钮外观预设 */
  disabled?: boolean;
  /** 追加到触发按钮的 class（错误边框、Doctor 的 neutral 配色等逃生舱） */
  smallTigger?: boolean;
  triggerClassName?: string;
  /** 覆盖按钮上显示的 label（SubAgent 的 'Inherit parent model'） */
  labelOverride?: string;
  /** 覆盖 invalid 判定（哨兵态显式视为有效） */
  invalidOverride?: boolean;
  /** 传给 GroupedModelPicker 的 value；默认取 `value`（哨兵态需传 ''） */
  pickerValue?: string;
  /** picker 上方插槽（SubAgent 的 Inherit 选项行）；接收 select 回调以在选中后关闭 popover */
  header?: (select: (composite: string) => void) => React.ReactNode;
  /** 追加到 PopoverContent 的 class（覆盖默认宽/高约束） */
  contentClassName?: string;
  /** 在冒泡阶段拦截 wheel（Doctor：Portal 落在 Dialog 的滚动锁区外） */
  stopWheelPropagation?: boolean;
  title?: string;
  onOpenChange?: (open: boolean) => void;
}

const DEFAULT_CONTENT_CLASS =
  'w-(--radix-popover-trigger-width) max-h-80 overflow-y-auto overflow-x-hidden p-1';

export const ModelSelectPopover: React.FC<Props> = ({
  value,
  onChange,
  disabled = false,
  smallTigger,
  triggerClassName,
  labelOverride,
  invalidOverride,
  pickerValue,
  header,
  contentClassName,
  stopWheelPropagation = false,
  title = 'Select AI Model',
  onOpenChange,
}) => {
  const [open, setOpen] = useState(false);
  const { label: derivedLabel, invalid: derivedInvalid } = useModelDisplayLabel(value);

  const invalid = invalidOverride ?? derivedInvalid;
  const label = labelOverride ?? (invalid ? 'Select Model' : derivedLabel);

  const handleOpenChange = (next: boolean) => {
    if (disabled) return;
    setOpen(next);
    onOpenChange?.(next);
  };

  const handleSelect = (composite: string) => {
    onChange(composite);
    setOpen(false);
    onOpenChange?.(false);
  };

  const chevron = (
    <ChevronDown
      size={14}
      strokeWidth={1.5}
      className={cn('shrink-0 opacity-50 transition-transform', open && 'rotate-180')}
    />
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          size={smallTigger ? 'sm' : undefined}
          disabled={disabled}
          title={title}
          className={cn('gap-1', triggerClassName)}
        >
          {invalid ? (
            <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0 text-amber-500" />
          ) : (
            <Cpu size={14} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
          )}
          <span className={cn('flex-1 text-left truncate', invalid && 'text-muted-foreground')}>
            {label}
          </span>
          {chevron}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(DEFAULT_CONTENT_CLASS, contentClassName)}
        align="start"
        sideOffset={4}
        onWheel={stopWheelPropagation ? (e) => e.stopPropagation() : undefined}
      >
        {header?.(handleSelect)}
        <GroupedModelPicker
          value={pickerValue ?? value}
          onChange={handleSelect}
          variant="popover"
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
};
