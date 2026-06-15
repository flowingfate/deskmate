import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ScrollArea } from '@/shadcn/scroll-area';
import { useSchedulesByAgentId } from '@/states/schedules.atom';
import { useAgentScheduleRuns, useAgentScheduleRunsHydrated } from '@/states/scheduleRuns.atom';
import type { JobRunRow } from '@shared/persist/types';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import RunsHeader from './RunsHeader';
import RunRow from './RunRow';

interface JobRunsViewProps {
  agentId: string;
  jobId: string;
  /** The session currently rendered on the right; highlights the matching run. */
  activeSessionId: string | null;
}

const REDIRECT_AFTER_MISSING_MS = 3000;

// Reused for the empty / loading / "no longer exists" lines below the header.
const HINT_CLASS = 'flex items-center justify-center p-2 text-[#9E9E9E] text-[12px]';

/**
 * Runs sub-screen: header (back / job name) + list of `JobRunRow`s for the
 * selected job. If the underlying job disappears (deleted concurrently),
 * shows a placeholder and redirects back to the jobs list after a short delay.
 *
 * Edit / Run now / Delete are NOT here — they live in `JobRow`'s expanded
 * panel back in the jobs list.
 */
const JobRunsView: React.FC<JobRunsViewProps> = ({ agentId, jobId, activeSessionId }) => {
  const navigate = useNavigate();
  const allRuns = useAgentScheduleRuns(agentId);
  const hydrated = useAgentScheduleRunsHydrated(agentId);
  const allJobs = useSchedulesByAgentId(agentId);
  const job = useMemo<SchedulerJob | null>(
    () => allJobs.find(j => j.id === jobId) ?? null,
    [allJobs, jobId],
  );

  // Runs come back already sorted by startedAt desc from the persist layer; filter only.
  const runs = useMemo<JobRunRow[]>(
    () => allRuns.filter(r => r.jobId === jobId),
    [allRuns, jobId],
  );

  // Auto-redirect when the underlying job no longer exists (deleted concurrently).
  // Wait until the schedules atom has hydrated at least once so we don't blip
  // on a fresh mount where `allJobs` is briefly empty.
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (job || allJobs.length === 0) {
      if (redirectTimer.current) {
        clearTimeout(redirectTimer.current);
        redirectTimer.current = null;
      }
      return;
    }
    redirectTimer.current = setTimeout(() => {
      navigate(`/agent/${agentId}/job`);
    }, REDIRECT_AFTER_MISSING_MS);
    return () => {
      clearTimeout(redirectTimer.current ?? undefined);
      redirectTimer.current = null;
    };
  }, [job, allJobs.length, agentId, navigate]);

  const handleSelectRun = useCallback((sessionId: string) => {
    navigate(`/agent/${agentId}/job/${jobId}/${sessionId}`);
  }, [agentId, jobId, navigate]);

  return (
    <div data-dbg="job-runs-view" className="contents">
      <RunsHeader
        agentId={agentId}
        job={job}
        fallbackName={job ? undefined : 'Schedule'}
      />

      <div data-dbg="job-runs-view-list" className="flex-1 min-h-0 overflow-hidden">
        {!job && allJobs.length > 0 && (
          <div className={HINT_CLASS}>Schedule no longer exists</div>
        )}

        {job && !hydrated && runs.length === 0 && (
          <div className={HINT_CLASS}>
            <Loader2 size={16} className="animate-spin" />
            <span className="ml-1.5">Loading runs...</span>
          </div>
        )}

        {job && hydrated && runs.length === 0 && (
          <div className={HINT_CLASS}>No runs yet.</div>
        )}

        {job && runs.length > 0 && (
          <ScrollArea
            type="scroll"
            className="h-full"
          >
            <div className="flex flex-col gap-[2px] py-1">
              {runs.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  isActive={activeSessionId === run.id}
                  onSelect={handleSelectRun}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};

export default JobRunsView;
