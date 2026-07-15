import React, { useCallback, useState } from 'react';
import { ChevronDown, Pencil, Play, Trash2 } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shadcn/tooltip';
import { cn } from '@/lib/utilities/utils';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import {
  deriveJobRowStatus,
  describeSchedule,
  formatDateTime,
  type JobRowStatus,
} from './utils';

interface JobRowProps {
  job: SchedulerJob;
  /** Number of historical runs for this job; surfaced inside the status tooltip only. */
  runCount: number;
  /**
   * Click on the row body. The parent decides where this leads (latest run
   * for once-jobs, runs sub-screen for cron, info toast when no runs exist).
   * Keeping the routing decision out of JobRow keeps it dumb and re-targetable.
   */
  onActivate: () => void;
  /** Status dot acts as the enable/disable toggle. */
  onToggleEnabled: (enabled: boolean) => void;
  /** Inline action buttons in the expanded panel. */
  onEdit: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}

// Per-status dot color. Hover scale + halo are appended dynamically below
// so we can leave them off entirely when the row is expired (= toggle disabled).
const STATUS_DOT_CLASS: Record<JobRowStatus, string> = {
  enabled:  'bg-[#10B981]',
  disabled: 'bg-black/25',
  expired:  'bg-[#B91C1C]',
};

// Halo color matching the dot tint; only used while the toggle is enabled.
const STATUS_DOT_HOVER_HALO: Record<JobRowStatus, string> = {
  enabled:  'group-hover/dot:shadow-[0_0_0_3px_rgba(16,185,129,0.18)]',
  disabled: 'group-hover/dot:shadow-[0_0_0_3px_rgba(0,0,0,0.04)]',
  expired:  '',
};

/**
 * Compact row in `JobsView`:
 *   [● toggle]  [name + cron desc]  [⌄ expand]
 * - Body click → `onActivate` (parent routes to a run session or runs list).
 * - Right chevron → toggle inline detail panel (Edit / Run now / Delete).
 * - Status dot → toggles `enabled`; tooltip surfaces state + schedule + run stats.
 *
 * Each interactive region is its own peer `<button>` so cursor drift between
 * mousedown / mouseup never lands on an ambiguous ancestor (the parent has no
 * onClick).
 */
const JobRow: React.FC<JobRowProps> = ({
  job,
  runCount,
  onActivate,
  onToggleEnabled,
  onEdit,
  onRunNow,
  onDelete,
}) => {
  const [expanded, setExpanded] = useState(false);

  const status: JobRowStatus = deriveJobRowStatus(job);
  const isExpired = status === 'expired';

  const stateLabel: string = isExpired
    ? 'Expired'
    : job.enabled
      ? 'Enabled'
      : 'Disabled';

  const handleToggleExpanded = useCallback(() => {
    setExpanded(v => !v);
  }, []);

  const handleDotClick = useCallback(() => {
    if (isExpired) return;
    onToggleEnabled(!job.enabled);
  }, [isExpired, job.enabled, onToggleEnabled]);

  const dotAriaLabel = isExpired
    ? 'This one-time schedule has already passed'
    : job.enabled ? 'Click to disable' : 'Click to enable';

  const runsLine = runCount === 0
    ? 'No runs yet'
    : `${runCount === 1 ? '1 run' : `${runCount} runs`}${
        job.lastStartedAt ? ` · Last ${formatDateTime(job.lastStartedAt)}` : ''
      }`;

  return (
    <div
      data-dbg="job-row"
      className={cn(
        'flex flex-col rounded-md border border-black/[0.05] bg-transparent transition-colors',
        'hover:bg-black/[0.05]',
        expanded && 'bg-black/[0.05]',
      )}
    >
      <div className="flex items-center gap-1 min-h-[56px] px-2 py-2 rounded-md">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              // `group/dot` lets the inner dot scale + tint when the button is hovered.
              // Hover background is gated on `enabled` so expired one-off jobs stay flat.
              className={cn(
                'group/dot inline-flex items-center justify-center w-6 h-6 p-0 m-0 shrink-0',
                'bg-transparent border-0 rounded-full cursor-pointer transition-colors',
                'focus-visible:outline-2 focus-visible:outline-black/25 focus-visible:outline-offset-1',
                'disabled:cursor-default',
                !isExpired && 'hover:bg-black/[0.06]',
              )}
              onClick={handleDotClick}
              disabled={isExpired}
              aria-label={dotAriaLabel}
            >
              <span
                aria-hidden
                className={cn(
                  'w-2 h-2 rounded-full transition-[transform,box-shadow] duration-[180ms] ease-out',
                  STATUS_DOT_CLASS[status],
                  // Scale + halo only render while interactive (expired = button disabled,
                  // so :disabled is true and the group's hover wouldn't fire anyway, but
                  // omitting the classes keeps the intent visible in source).
                  !isExpired && 'group-hover/dot:scale-150',
                  !isExpired && STATUS_DOT_HOVER_HALO[status],
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="max-w-60 flex flex-col gap-[2px] text-[11px] leading-[1.4]"
          >
            <div>
              <strong>{stateLabel}</strong>
              <span> · {describeSchedule(job)}</span>
            </div>
            <div className="opacity-75">{runsLine}</div>
            {!isExpired && (
              <div className="mt-[2px] opacity-60 italic">{dotAriaLabel}</div>
            )}
          </TooltipContent>
        </Tooltip>
        <button
          type="button"
          className={cn(
            'flex-1 min-w-0 flex flex-col items-stretch gap-[2px] px-1 py-0 m-0',
            'bg-transparent border-0 text-left cursor-pointer font-inherit text-inherit',
            'focus-visible:outline-2 focus-visible:outline-black/20 focus-visible:outline-offset-2 focus-visible:rounded-[4px]',
          )}
          onClick={onActivate}
          title={job.name}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate min-w-0 text-sm font-semibold leading-[18px] text-content">
              {job.name}
            </span>
            {runCount > 0 && (
              <span
                aria-label={runCount === 1 ? '1 run' : `${runCount} runs`}
                title={runCount === 1 ? '1 run' : `${runCount} runs`}
                className={cn(
                  'shrink-0 inline-flex items-center justify-center',
                  'min-w-4 h-4 px-1 rounded-lg',
                  'bg-black/[0.06] text-[#6C6C70] text-[10px] font-semibold tabular-nums leading-none',
                )}
              >
                {runCount}
              </span>
            )}
          </span>
          <span className="truncate text-[11px] text-[#6C6C70] leading-[14px]">
            {describeSchedule(job)}
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          // The chevron rotates 180° when expanded; transition lives on the
          // SVG via [&_svg]:transition so it animates regardless of how the
          // Button slot wraps the icon.
          className={cn(
            'shrink-0 [&_svg]:transition-transform [&_svg]:duration-200',
            expanded && '[&_svg]:rotate-180',
          )}
          onClick={handleToggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse details' : 'Show details'}
          title={expanded ? 'Collapse details' : 'Show details'}
        >
          <ChevronDown size={16} strokeWidth={1.5} />
        </Button>
      </div>
      {/*
       * Inline expansion via the grid-template-rows trick: 0fr → 1fr animates
       * the height around the natural content size. The inner div clips its
       * overflow so measurement still happens cleanly while collapsed.
       */}
      <div
        aria-hidden={!expanded}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out border-t',
          expanded ? 'grid-rows-[1fr] border-black/[0.05] pt-2' : 'grid-rows-[0fr] border-transparent pt-0',
        )}
      >
        <div
          className={cn(
            'overflow-hidden min-h-0 px-2 flex flex-col gap-2',
            expanded && 'pb-2.5',
          )}
        >
          {job.lastStartedAt && (
            <div className="flex items-baseline gap-1.5 px-1 text-[11px] leading-[14px]">
              <span className="text-[#9E9E9E] font-medium">Last started</span>
              <span className="text-[#6C6C70] truncate">{formatDateTime(job.lastStartedAt)}</span>
            </div>
          )}
          <div className="flex items-center flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 font-medium"
              onClick={onEdit}
            >
              <Pencil size={12} strokeWidth={1.5} />
              <span>Edit</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 font-medium"
              onClick={onRunNow}
              disabled={!job.enabled}
              title={job.enabled ? undefined : 'Enable this schedule before running it now'}
            >
              <Play size={12} strokeWidth={1.5} />
              <span>Run now</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 font-medium text-[#B91C1C] hover:bg-[#B91C1C]/[0.08] hover:text-[#991B1B]"
              onClick={onDelete}
            >
              <Trash2 size={12} strokeWidth={1.5} />
              <span>Delete</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobRow;
