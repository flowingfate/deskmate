import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/shadcn/button';
import type { SchedulerJob } from '@shared/ipc/scheduler';

interface RunsHeaderProps {
  /** Owning agent's agentId, used to navigate back to the jobs list. */
  agentId: string;
  /**
   * The job whose runs are shown. `null` when the job no longer exists —
   * `JobRunsView` already shows a placeholder + redirects, but the header
   * still renders briefly with a fallback title.
   */
  job: SchedulerJob | null;
  fallbackName?: string;
}

/**
 * Sticky strip at the top of `JobRunsView`: back arrow + job name.
 * Edit / Run now / Delete used to live here as an overflow menu — those
 * actions are now reached from `JobRow`'s expanded panel in the jobs list.
 * Keeping this header minimal because the runs sub-screen is a navigation
 * layer, not an action surface.
 */
const RunsHeader: React.FC<RunsHeaderProps> = ({ agentId, job, fallbackName }) => {
  const navigate = useNavigate();
  const handleBack = useCallback(() => {
    navigate(`/agent/${agentId}/job`);
  }, [agentId, navigate]);

  const displayName = job?.name ?? fallbackName ?? 'Schedule';

  return (
    <div
      data-dbg="runs-header"
      className="flex items-center gap-1 h-9 shrink-0 mb-1"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleBack}
        title="Back to schedules"
        aria-label="Back to schedules"
      >
        <ArrowLeft size={16} strokeWidth={1.5} />
      </Button>
      <span
        className="flex-1 min-w-0 truncate text-sm font-semibold text-content"
        title={displayName}
      >
        {displayName}
      </span>
    </div>
  );
};

export default RunsHeader;
