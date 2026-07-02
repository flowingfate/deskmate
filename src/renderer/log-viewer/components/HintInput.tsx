// 带语法提示 popover 的 input。
//
// 设计要点：
//   - outer input 仍可直接输入（不剥夺功能），popover 是辅助
//   - focus 自动打开 popover，但不抢 outer 焦点（preventDefault on autoFocus）
//   - popover 内：title / syntax / 示例列表 / 模板编辑框 / Apply
//   - 示例点击 → 覆盖到模板框；Apply → commit 到 outer
//   - 关闭时机：Apply / Esc / 点击 popover 之外；不绑 onBlur 避免误关

import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/shadcn/popover';
import { Input } from '@/shadcn/input';
import { cn } from '@/lib/utilities/utils';

export interface HintExample {
  template: string;
  description: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  title: string;
  syntax: string;
  examples: HintExample[];
}

export function HintInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  title,
  syntax,
  examples,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时把当前外部值同步到 draft；关闭后不主动同步，避免用户编辑中被覆盖
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  function apply(v: string) {
    onChange(v);
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          className={cn(inputClassName, className)}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[320px] p-3"
        // 关键：不让 popover 抢走 outer input 的焦点
        onOpenAutoFocus={(e) => e.preventDefault()}
        // 用户在 outer 里继续打字时不要关闭
        onInteractOutside={(e) => {
          if (e.target === inputRef.current) e.preventDefault();
        }}
      >
        <div className="space-y-2.5">
          <div>
            <div className="text-[12px] font-semibold text-slate-800">{title}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{syntax}</div>
          </div>

          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Examples (click to use)
            </div>
            <ul className="space-y-0.5">
              {examples.map((ex) => (
                <li key={ex.template}>
                  <button
                    type="button"
                    onClick={() => setDraft(ex.template)}
                    className="group flex w-full items-center justify-between gap-3 rounded-sm px-1.5 py-1 text-left hover:bg-slate-100"
                  >
                    <code className="font-mono text-[11px] text-slate-800 group-hover:text-neutral-700">
                      {ex.template}
                    </code>
                    <span className="truncate text-[10px] text-slate-400">{ex.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5 border-t border-slate-100 pt-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Edit & apply
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    apply(draft);
                  }
                }}
                placeholder={placeholder}
                className="h-7 flex-1 rounded-md border border-slate-200 bg-white px-2 font-mono text-[12px] text-slate-800 placeholder:text-slate-400 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-500/25"
              />
              <button
                type="button"
                onClick={() => apply(draft)}
                disabled={draft === value}
                className={cn(
                  'h-7 rounded-md px-3 text-[12px] font-medium transition-colors',
                  draft !== value
                    ? 'bg-neutral-600 text-white hover:bg-neutral-700'
                    : 'cursor-not-allowed bg-slate-100 text-slate-400',
                )}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
