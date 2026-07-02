// LogsView toolbar：单 strip 48px。
//
// 设计要点（吃过亏的）：
//   - 所有控件高度统一 28px，用 `!h-[28px] !py-0 !text-[12px]` 强覆盖 shadcn 默认 h-10
//   - input 不再放 absolute icon（撞 placeholder），用 placeholder 表达语义
//   - Level trigger 只显示色点 + 大写文字；下拉里也不写 "≥"（trigger 区窄装不下）
//   - 控件间 gap-2.5，外侧 px-4 给左右呼吸

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Input } from '@/shadcn/input';
import { Button } from '@/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/shadcn/select';
import { cn } from '@/lib/utilities/utils';
import { DEFAULT_FORM, type FilterForm } from '../filter';
import { LEVELS, LEVEL_NUM, levelDotClass } from '../levels';
import { TimeRangePicker } from './TimeRangePicker';
import { LifePicker } from './LifePicker';
import { HintInput, type HintExample } from './HintInput';

interface Props {
  form: FilterForm;
  onChange: (next: FilterForm) => void;
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  onRefresh: () => void;
  error: string | null;
  totalRows: number;
  loading: boolean;
}

const DEBOUNCE_MS = 250;

// 强覆盖 shadcn 默认尺寸；padding 用 px-2.5 给 placeholder 充足空间
const ctl =
  '!h-[28px] !py-0 !px-2.5 !text-[12px] !leading-[28px] !rounded-md !shadow-none ' +
  '!border !border-slate-200 !bg-white !text-slate-800 placeholder:!text-slate-400 ' +
  'focus-visible:!border-neutral-400 focus-visible:!ring-1 focus-visible:!ring-neutral-500/25 ' +
  'focus-visible:!ring-offset-0 focus:!ring-offset-0';

const btn =
  '!h-[28px] !rounded-md !px-2.5 gap-1.5 text-[12px] text-slate-600 hover:bg-slate-100 hover:text-slate-900';

const COMPONENT_EXAMPLES: HintExample[] = [
  { template: 'chat.*', description: 'All chat subsystem' },
  { template: '*agent*', description: 'Anywhere "agent" appears' },
  { template: 'mcp.runtime', description: 'Exact component' },
  { template: 'auth.?', description: '? = single char' },
];

const GREP_EXAMPLES: HintExample[] = [
  { template: '"timeout"', description: 'Literal word (quote it)' },
  { template: 'connection AND failed', description: 'Both terms' },
  { template: 'oom OR "out of memory"', description: 'Either' },
  { template: 'login NOT success', description: 'Exclude term' },
  { template: 'msg:"handshake"', description: 'Limit to msg column' },
];

export function LogsToolbar({
  form,
  onChange,
  follow,
  onFollowChange,
  onRefresh,
  error,
  totalRows,
  loading,
}: Props) {
  const [local, setLocal] = useState(form);

  useEffect(() => setLocal(form), [form]);

  useEffect(() => {
    if (local === form) return;
    const t = setTimeout(() => onChange(local), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [local, form, onChange]);

  function patch<K extends keyof FilterForm>(k: K, v: FilterForm[K]) {
    setLocal((s) => ({ ...s, [k]: v }));
  }

  const hasFilter =
    !!local.componentGlob ||
    !!local.grep ||
    !!local.traceId ||
    !!local.minLevel ||
    !!local.until ||
    local.lifeId != null ||
    local.since !== '15m';

  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-vw-divider bg-white px-4">
      {/* Title block */}
      <div className="flex items-center gap-2 pr-1">
        <h1 className="text-[13px] font-semibold tracking-tight text-slate-900">Logs</h1>
        <span className="text-[11px] tabular-nums text-slate-500">
          {totalRows.toLocaleString()}
        </span>
        <LiveToggle on={follow} onToggle={onFollowChange} />
      </div>

      <Divider />

      <LifePicker
        value={local.lifeId}
        onChange={(next, { clearTime }) => {
          // 锁定到某个 life 时清空 since/until：life 已隐含时间窗口，再叠 since 反而把日志切碎。
          // 取消 life 锁定时保持时间不动，让用户能延续当前视图。
          if (clearTime) {
            setLocal((s) => ({ ...s, lifeId: next, since: '', until: '' }));
          } else {
            setLocal((s) => ({ ...s, lifeId: next }));
          }
        }}
      />
      <TimeRangePicker
        since={local.since}
        until={local.until}
        onChange={(since, until) => setLocal((s) => ({ ...s, since, until }))}
      />

      <Select
        value={local.minLevel || '__any'}
        onValueChange={(v) =>
          patch('minLevel', v === '__any' ? '' : (v as FilterForm['minLevel']))
        }
      >
        <SelectTrigger
          className={cn(
            ctl,
            'w-[112px] !pr-2 [&>span]:flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:line-clamp-1',
          )}
        >
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                local.minLevel ? levelDotClass(LEVEL_NUM[local.minLevel]) : 'bg-slate-300',
              )}
            />
            <span className="font-mono text-[11px] uppercase tracking-wide">
              {local.minLevel || 'ANY'}
            </span>
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-slate-300"
              />
              <span className="text-[12px]">All levels</span>
            </span>
          </SelectItem>
          {LEVELS.map((l) => (
            <SelectItem key={l} value={l}>
              <span className="flex items-center gap-2">
                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', levelDotClass(LEVEL_NUM[l]))} />
                <span className="font-mono text-[11px] uppercase">{l}</span>
                <span className="text-[10px] text-slate-400">and above</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <HintInput
        className="w-[160px] font-mono"
        inputClassName={ctl}
        value={local.componentGlob}
        placeholder="component"
        onChange={(v) => patch('componentGlob', v)}
        title="Component (glob)"
        syntax="* = any chars, ? = single char. Empty = all components."
        examples={COMPONENT_EXAMPLES}
      />

      <HintInput
        className="min-w-0 flex-1 font-mono"
        inputClassName={ctl}
        value={local.grep}
        placeholder="full-text search"
        onChange={(v) => patch('grep', v)}
        title="Full-text search (SQLite FTS5)"
        syntax='Words = AND. Use AND / OR / NOT, quote literals, col:term to scope.'
        examples={GREP_EXAMPLES}
      />

      <Input
        className={cn(ctl, 'w-[140px] font-mono')}
        value={local.traceId}
        placeholder="traceId"
        onChange={(e) => patch('traceId', e.target.value)}
      />

      {hasFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLocal(DEFAULT_FORM);
            onChange(DEFAULT_FORM);
          }}
          className={cn(btn, 'text-slate-500')}
        >
          <X className="h-3 w-3" />
          Reset
        </Button>
      )}

      <Divider />

      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={loading}
        className={btn}
        title="Refresh (⌘R)"
      >
        <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        <span className="hidden md:inline">Refresh</span>
      </Button>

      {error && (
        <span
          className="ml-1 inline-flex h-[28px] max-w-[280px] items-center truncate rounded-md border border-lvl-error/30 bg-lvl-error/10 px-2.5 font-mono text-[11px] text-lvl-error"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return <span className="h-5 w-px shrink-0 bg-slate-200" />;
}

function LiveToggle({ on, onToggle }: { on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      className={cn(
        'group ml-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-[10px] font-medium uppercase tracking-wider transition-colors',
        on
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600',
      )}
      title={on ? 'Disable live tailing' : 'Enable live tailing'}
    >
      <span className="relative flex h-1.5 w-1.5">
        {on && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            on ? 'bg-emerald-500' : 'bg-slate-300',
          )}
        />
      </span>
      Live
    </button>
  );
}
