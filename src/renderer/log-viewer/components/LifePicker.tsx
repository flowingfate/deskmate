// Life 锚点选择器：列出最近 N 个 life，点选 = 限定查询到该 life。
//
// 设计要点：
//   - "Life 是绝大多数排查的入口" —— 把它放在 toolbar 最左（贴 title），不与时间范围混淆
//   - chip 始终显示"Life 28"或"Life 28 · current"；空 = "All lives"（淡灰）
//   - 选 life 时自动把 since/until 清空：life 已经隐含时间窗口，再叠 since 反而把日志切碎
//     —— 当用户既想限 life 又想限时间时，可在 TimeRangePicker 里再手动加
//   - 列表项展示：[id] [current?] [rows] [跨度 / "n 分钟前"]，无需第二排
//   - 数据用 lazy load：popover 第一次打开时拉一次；之后不再拉（dev 用，不强求 live）
//
// 与 TimeRangePicker 视觉对齐：28px 高、icon + label，hover/focus 蓝边

import { useState } from 'react';
import { Check, History } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shadcn/popover';
import { cn } from '@/lib/utilities/utils';
import type { LifeInfo } from '@shared/ipc/logViewer';
import { viewerApi } from '../api';
import { formatRelative } from '../levels';

interface Props {
  value: number | null;
  onChange: (next: number | null, opts: { clearTime: boolean }) => void;
}

export function LifePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [lives, setLives] = useState<LifeInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function ensureLoaded() {
    if (lives != null || loading) return;
    setLoading(true);
    setError(null);
    viewerApi
      .lives({ limit: 30 })
      .then((rows) => setLives(rows))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  const label = formatLabel(value, lives);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) ensureLoaded();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5',
            'text-[12px] text-slate-800 hover:border-slate-300',
            'focus-visible:border-neutral-400 focus-visible:ring-1 focus-visible:ring-neutral-500/25 focus-visible:outline-none',
            open && 'border-neutral-400 ring-1 ring-neutral-500/25',
            value == null && 'text-slate-500',
          )}
          title="Life — limit query to a single app run"
        >
          <History className="h-3 w-3 text-slate-400" />
          <span className="max-w-[160px] truncate font-mono text-[12px]">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-1">
        <button
          type="button"
          onClick={() => {
            onChange(null, { clearTime: false });
            setOpen(false);
          }}
          className={cn(
            'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[12px]',
            'hover:bg-slate-100',
            value == null && 'bg-neutral-50 text-neutral-700',
          )}
        >
          <span>All lives</span>
          {value == null && <Check className="h-3 w-3" />}
        </button>
        <div className="my-1 h-px bg-slate-200" />
        <div className="thin-scroll max-h-[320px] overflow-auto">
          {loading && (
            <div className="px-2 py-3 text-center text-[11px] text-slate-400">Loading…</div>
          )}
          {error && (
            <div className="px-2 py-2 text-[11px] text-red-600">{error}</div>
          )}
          {!loading && !error && lives && lives.length === 0 && (
            <div className="px-2 py-3 text-center text-[11px] text-slate-400">No lives recorded</div>
          )}
          {lives?.map((life) => {
            const active = life.id === value;
            return (
              <button
                key={life.id}
                type="button"
                onClick={() => {
                  onChange(life.id, { clearTime: true });
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-start justify-between rounded-sm px-2 py-1.5 text-left',
                  'hover:bg-slate-100',
                  active && 'bg-neutral-50 text-neutral-700',
                )}
              >
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[12px]">Life {life.id}</span>
                    {life.current && (
                      <span className="rounded-sm bg-emerald-100 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-emerald-700">
                        current
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {life.rows.toLocaleString()} {plural('row', life.rows)} · {formatRelative(life.lastTs)} · {formatDuration(life.lastTs - life.firstTs)}
                  </span>
                </span>
                {active && <Check className="mt-0.5 h-3 w-3" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatLabel(value: number | null, lives: LifeInfo[] | null): string {
  if (value == null) return 'All lives';
  const info = lives?.find((l) => l.id === value);
  if (!info) return `Life ${value}`;
  return info.current ? `Life ${value} · current` : `Life ${value}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}
