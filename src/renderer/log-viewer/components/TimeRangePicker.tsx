// 时间范围选择器：preset 列表 + 自定义 since/until。
//
// 设计要点：
//   - 主入口窄 chip，label 优先显示匹配到的 preset；自定义值降级为 "since → until"
//   - Popover 内：preset 列表一键直达；Custom 区有完整语法 hint 和 inline 错误反馈
//   - 输入即时本地校验（parseSince/parseUntil），失败 inline 提示；仅成功才回写表单
//   - 自定义输入用 240px 宽，可容纳 ISO 时间戳

import { useMemo, useState } from 'react';
import { Check, Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/shadcn/popover';
import { cn } from '@/lib/utilities/utils';
import { parseSince, parseUntil } from '@shared/log/query';

interface Preset {
  label: string;
  since: string;
  until: string; // '' = now
}

const PRESETS: Preset[] = [
  { label: 'Last 5 minutes', since: '5m', until: '' },
  { label: 'Last 15 minutes', since: '15m', until: '' },
  { label: 'Last 1 hour', since: '1h', until: '' },
  { label: 'Last 6 hours', since: '6h', until: '' },
  { label: 'Last 24 hours', since: '1d', until: '' },
  { label: 'Last 7 days', since: '7d', until: '' },
];

interface Props {
  since: string;
  until: string;
  onChange: (since: string, until: string) => void;
}

function matchPreset(since: string, until: string): Preset | null {
  return PRESETS.find((p) => p.since === since && p.until === (until || '')) ?? null;
}

function formatLabel(since: string, until: string): string {
  const preset = matchPreset(since, until);
  if (preset) return preset.label;
  const left = since || 'start';
  const right = until || 'now';
  return `${left} → ${right}`;
}

export function TimeRangePicker({ since, until, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const label = useMemo(() => formatLabel(since, until), [since, until]);
  const activePreset = matchPreset(since, until);

  function applyPreset(p: Preset) {
    onChange(p.since, p.until);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5',
            'text-[12px] text-slate-800 hover:border-slate-300',
            'focus-visible:border-neutral-400 focus-visible:ring-1 focus-visible:ring-neutral-500/25 focus-visible:outline-none',
            open && 'border-neutral-400 ring-1 ring-neutral-500/25',
          )}
          title="Time range"
        >
          <Clock className="h-3 w-3 text-slate-400" />
          <span className="max-w-[160px] truncate font-mono text-[12px]">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-1">
        <ul className="py-1">
          {PRESETS.map((p) => {
            const active = activePreset?.label === p.label;
            return (
              <li key={p.label}>
                <button
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[12px]',
                    'hover:bg-slate-100',
                    active && 'bg-neutral-50 text-neutral-700',
                  )}
                >
                  <span>{p.label}</span>
                  {active && <Check className="h-3 w-3" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="my-1 h-px bg-slate-200" />
        <CustomRange
          since={since}
          until={until}
          onApply={(s, u) => {
            onChange(s, u);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function CustomRange({
  since,
  until,
  onApply,
}: {
  since: string;
  until: string;
  onApply: (since: string, until: string) => void;
}) {
  const [s, setS] = useState(since);
  const [u, setU] = useState(until);

  const sErr = validate(s, 'since');
  const uErr = validate(u, 'until');
  const dirty = s !== since || u !== until;
  const canApply = !sErr && !uErr && dirty;

  return (
    <div className="space-y-2 p-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Custom range
      </div>

      <Field label="From" value={s} onChange={setS} placeholder="10m" error={sErr} />
      <Field label="To" value={u} onChange={setU} placeholder="now (empty)" error={uErr} />

      <div className="rounded-sm bg-slate-50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
        <div>Relative: <code className="font-mono text-slate-700">10m · 2h · 1d · 1w</code></div>
        <div>Absolute: <code className="font-mono text-slate-700">@2026-05-28T10:00</code></div>
        <div>Special: <code className="font-mono text-slate-700">now</code></div>
      </div>

      <button
        type="button"
        disabled={!canApply}
        onClick={() => onApply(s.trim(), u.trim())}
        className={cn(
          'h-7 w-full rounded-md text-[12px] font-medium transition-colors',
          canApply
            ? 'bg-neutral-600 text-white hover:bg-neutral-700'
            : 'cursor-not-allowed bg-slate-100 text-slate-400',
        )}
      >
        Apply
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  error: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-9 text-[11px] text-slate-500">{label}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'h-7 flex-1 rounded-md border bg-white px-2 font-mono text-[12px] text-slate-800',
            'placeholder:text-slate-400 focus:outline-none focus:ring-1',
            error
              ? 'border-red-300 focus:border-red-400 focus:ring-red-400/30'
              : 'border-slate-200 focus:border-neutral-400 focus:ring-neutral-500/25',
          )}
        />
      </div>
      {error && (
        <div className="ml-11 mt-0.5 text-[10px] text-red-500">{error}</div>
      )}
    </div>
  );
}

function validate(v: string, kind: 'since' | 'until'): string | null {
  const t = v.trim();
  if (!t) return null; // 空合法：since 空=不限起点，until 空=now
  try {
    if (kind === 'since') parseSince(t);
    else parseUntil(t);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
