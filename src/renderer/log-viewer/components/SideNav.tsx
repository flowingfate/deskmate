// 左侧 SideNav · 52px 宽。
//
// 三段式结构（与右侧主区共享水平基线）：
//   ┌─────────┐
//   │ Brand   │  48px (与 LogsToolbar 同高，bottom divider 贯穿)
//   ├─────────┤
//   │ Items   │  flex-1，每项 h-9，竖向 gap-1
//   ├─────────┤
//   │ Footer  │  db 状态指示，top divider
//   └─────────┘
//
// 颜色 token 全部走 tailwind utility（bg-vw-* / text-vw-* / border-vw-*），不用 inline style。
// TooltipProvider 由 log-viewer/App.tsx 顶层统一提供。

import { Tooltip, TooltipContent, TooltipTrigger } from '@/shadcn/tooltip';
import { cn } from '@/lib/utilities/utils';
import { VIEWS } from '../views';
import { currentViewAtom, dbPathAtom } from '../states/view.atom';

export function SideNav() {
  const [current, onChange] = currentViewAtom.use();
  const dbPath = dbPathAtom.useData();
  return (
    <nav className="flex w-[52px] shrink-0 flex-col border-r border-vw-divider bg-vw-nav-bg">
      {/* Brand strip — 48px，与右侧 toolbar 同高 */}
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-vw-divider">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-vw-accent text-white">
          <span className="font-mono text-[12px] font-bold leading-none">L</span>
        </div>
      </div>

      {/* Items */}
      <ul className="flex flex-1 flex-col items-stretch gap-1 px-1.5 py-3">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = current === v.id;
          return (
            <li key={v.id} className="relative">
              {active && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -left-1.5 top-0 h-full w-[2px] rounded-r-full bg-vw-accent"
                />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onChange(v.id)}
                    disabled={v.placeholder}
                    className={cn(
                      'flex h-9 w-full items-center justify-center rounded-md transition-colors',
                      active
                        ? 'text-vw-accent'
                        : 'text-slate-400 hover:bg-white hover:text-slate-700',
                      v.placeholder &&
                        'opacity-35 cursor-not-allowed hover:bg-transparent hover:text-slate-400',
                    )}
                    aria-label={v.label}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-[17px] w-[17px]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {v.label}
                  {v.placeholder && <span className="ml-1 text-slate-400">· soon</span>}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      {/* Footer — db status */}
      <div className="flex shrink-0 items-center justify-center border-t border-vw-divider py-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-600"
              aria-label="Database status"
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  dbPath
                    ? 'bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20'
                    : 'bg-slate-300',
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[320px] break-all text-xs">
            {dbPath ?? 'db not connected'}
          </TooltipContent>
        </Tooltip>
      </div>
    </nav>
  );
}
