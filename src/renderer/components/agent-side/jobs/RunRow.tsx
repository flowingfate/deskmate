import React, { useCallback } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { cn } from '@/lib/utilities/utils';
import type { JobRunRow } from '@shared/persist/types';
import { ChatSessionMenuAtom } from '@/components/menu/ChatSessionDropdownMenu';
import { ExecutingIcon, CompletedIcon, InterruptedIcon, FailedIcon } from './runStatusIcons';
import { getScheduledSessionDisplayState, formatRunTime } from './utils';

interface RunRowProps {
  run: JobRunRow;
  /** Active session highlight. */
  isActive: boolean;
  onSelect: (sessionId: string) => void;
}

/**
 * Single row in `JobRunsView`: status icon + run title + completed/error subtitle.
 * Right-side `MoreHorizontal` opens `ChatSessionMenuAtom` in `schedule` source mode
 * (Download / Delete only — see `ChatSessionDropdownMenu`).
 */
const RunRow: React.FC<RunRowProps> = ({ run, isActive, onSelect }) => {
  const [
    { isOpen: menuIsOpen, sessionId: menuSessionId },
    menuActions,
  ] = ChatSessionMenuAtom.use();
  const isMenuOpen = menuIsOpen && menuSessionId === run.id;

  const state = getScheduledSessionDisplayState(run);
  const isUnread = run.readStatus !== 'read' && !isActive;

  const handleClick = useCallback(() => {
    onSelect(run.id);
  }, [onSelect, run.id]);

  const handleMenuToggle = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const trigger = e.currentTarget as HTMLElement;
    // Tells `ChatSessionDropdownMenu` to render the schedule-mode menu (Download / Delete only).
    trigger.dataset.chatSessionMenuSource = 'schedule';
    menuActions.toggle(run.agentId, run.id, run.title, trigger);
  }, [menuActions, run.agentId, run.id, run.title]);

  const finishedAt = run.runStatus === 'running' ? null : run.finishedAt;
  const error = run.runStatus === 'failed' ? run.runError : null;

  let icon: React.ReactNode;
  let subtitle: string;
  let subtitleError = false;
  switch (state) {
    case 'running':
      icon = <ExecutingIcon />;
      subtitle = formatRunTime(run.startedAt);
      break;
    case 'completed':
      icon = <CompletedIcon />;
      subtitle = formatRunTime(finishedAt ?? run.startedAt);
      break;
    case 'interrupted':
      icon = <InterruptedIcon />;
      subtitle = `Interrupted${finishedAt ? ` · ${formatRunTime(finishedAt)}` : ''}`;
      break;
    case 'failed':
      icon = <FailedIcon />;
      subtitle = `Failed${error ? ` · ${error}` : ''}`;
      subtitleError = true;
      break;
  }

  return (
    <div
      data-dbg="run-row"
      // `group/row` keeps the more-button reveal local to this row.
      className={cn(
        'group/row flex items-center gap-2.5 min-h-12 px-2 py-2 rounded',
        'cursor-pointer bg-transparent transition-colors',
        'hover:bg-black/[0.05]',
        isActive && 'bg-black/[0.05]',
      )}
      onClick={handleClick}
      title={run.title}
    >
      <div className="flex items-center justify-center w-5 h-5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
        <div
          className={cn(
            'truncate text-sm leading-[18px] text-[#6C6C70] font-[410]',
            isUnread && 'text-content font-semibold',
          )}
        >
          {run.title}
        </div>
        <div
          className={cn(
            'truncate text-[11px] leading-[14px] text-[#6B7280]',
            subtitleError && 'text-[#B91C1C]',
            isUnread && !subtitleError && 'text-[#374151] font-semibold',
          )}
        >
          {subtitle}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn(
          'shrink-0 opacity-0 group-hover/row:opacity-100',
          isMenuOpen && 'opacity-100',
        )}
        onClick={handleMenuToggle}
        title="More options"
        aria-label="More options"
      >
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </Button>
    </div>
  );
};

export default RunRow;
