import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/shadcn/button';
import { schedulerApi } from '@/ipc/scheduler';
import { useSchedulesByAgentId } from '@/states/schedules.atom';
import { useAgentScheduleRuns } from '@/states/scheduleRuns.atom';
import { useAgentById } from '@/states/agents.atom';
import { useToast } from '@/components/ui/ToastProvider';
import { TooltipProvider } from '@/shadcn/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shadcn/alert-dialog';
import { showScheduledRunStartedToast } from '@/lib/scheduler/showScheduledRunStartedToast';
import ScheduleOverlay from '@renderer/components/agent-side/jobs/overlay';
import {
  SCHEDULE_TEMPLATES,
  type ScheduleTemplateInitialValues,
} from '@renderer/components/agent-side/jobs/templates';
import type { JobRunRow } from '@shared/persist/types';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { log } from '@/log';
import JobHeader from './JobHeader';
import JobRow from './JobRow';

const logger = log.child({ mod: 'JobsView' });

interface JobsViewProps {
  /** Always defined here — `SessionPanel` only mounts this when a agentId exists. */
  agentId: string;
}

/**
 * Jobs sub-screen: search-filtered list of `SchedulerJob` rows + add-schedule
 * overlay. Job CRUD round-trips through `schedulerApi`; the underlying list
 * auto-refreshes via `schedules.atom`'s persist event subscriptions.
 */
const JobsView: React.FC<JobsViewProps> = ({ agentId }) => {
  const navigate = useNavigate();
  const { showToast, showSuccess, showError, showInfo } = useToast();
  const agent = useAgentById(agentId);
  const jobs = useSchedulesByAgentId(agentId);
  const runs = useAgentScheduleRuns(agentId);
  const [searchQuery, setSearchQuery] = useState('');

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<SchedulerJob | null>(null);
  const [templateValues, setTemplateValues] = useState<ScheduleTemplateInitialValues | undefined>(undefined);
  // Pending deletion target. The dialog renders only when non-null; confirming
  // calls `schedulerApi.deleteJob`. Centralized here (vs. per-row dialogs) so a
  // single AlertDialog instance handles every JobRow's delete action.
  const [pendingDelete, setPendingDelete] = useState<SchedulerJob | null>(null);

  const templateContext = useMemo(() => ({ agentName: agent?.name }), [agent?.name]);

  const filteredJobs = useMemo<SchedulerJob[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter(j => j.name.toLowerCase().includes(q));
  }, [jobs, searchQuery]);

  /**
   * Per-job run feed (latest first, since `useAgentScheduleRuns` returns runs
   * sorted by `startedAt` desc). One pass over `runs` builds the bucket map;
   * `runCount` for the row is `list.length`, and once-job activation reads
   * `list[0]` to skip straight into the latest session.
   */
  const runsByJob = useMemo<Map<string, JobRunRow[]>>(() => {
    const m = new Map<string, JobRunRow[]>();
    for (const r of runs) {
      const list = m.get(r.jobId);
      if (list) list.push(r);
      else m.set(r.jobId, [r]);
    }
    return m;
  }, [runs]);

  // ─── Action handlers ────────────────────────────────────────────────

  const handleOpenBlank = useCallback(() => {
    setEditingJob(null);
    setTemplateValues(undefined);
    setOverlayOpen(true);
  }, []);

  const handleOpenTemplate = useCallback((templateId: string) => {
    const template = SCHEDULE_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;
    setEditingJob(null);
    setTemplateValues(template.buildInitialValues(templateContext));
    setOverlayOpen(true);
  }, [templateContext]);

  /**
   * Body-click activation. Cron jobs always go to the runs list (a one-step
   * detour even when there's a single run keeps the UX consistent across
   * recurring schedules). Once-jobs jump straight to the latest run's
   * session, since users almost never want a 1-row list as an interstitial.
   * No runs at all → an info toast instead of routing to an empty page.
   */
  const handleActivate = useCallback((job: SchedulerJob) => {
    const jobRuns = runsByJob.get(job.id);
    if (!jobRuns || jobRuns.length === 0) {
      showInfo("This schedule hasn't run yet.");
      return;
    }
    navigate(`/agent/${agentId}/job/${job.id}/${jobRuns[0].id}`);
  }, [agentId, navigate, runsByJob, showInfo]);

  const handleEdit = useCallback((job: SchedulerJob) => {
    setEditingJob(job);
    setTemplateValues(undefined);
    setOverlayOpen(true);
  }, []);

  const handleToggle = useCallback(async (jobId: string, enabled: boolean) => {
    try {
      const res = await schedulerApi.toggleJob(jobId, enabled);
      if (!res?.success) {
        showError('Failed to toggle schedule: ' + (res?.error || 'Unknown error'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Failed to toggle schedule: ' + msg);
      logger.error({ msg: 'toggleJob failed', jobId, err });
    }
  }, [showError]);

  const handleRequestDelete = useCallback((job: SchedulerJob) => {
    setPendingDelete(job);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const job = pendingDelete;
    if (!job) return;
    setPendingDelete(null);
    try {
      const res = await schedulerApi.deleteJob(job.id);
      if (!res?.success) {
        showError('Failed to delete schedule: ' + (res?.error || 'Unknown error'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Failed to delete schedule: ' + msg);
      logger.error({ msg: 'deleteJob failed', jobId: job.id, err });
    }
  }, [pendingDelete, showError]);

  const handleRunNow = useCallback(async (job: SchedulerJob) => {
    try {
      const res = await schedulerApi.runJobNow(job.id);
      if (res?.success) {
        showScheduledRunStartedToast({
          result: res.data,
          agentId: job.agentId,
          jobId: job.id,
          navigate,
          showToast,
          showSuccess,
        });
        return;
      }
      showError('Failed to run schedule: ' + (res?.error || 'Unknown error'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Failed to run schedule: ' + msg);
      logger.error({ msg: 'runJobNow failed', jobId: job.id, err });
    }
  }, [navigate, showError, showSuccess, showToast]);

  // ─── Render ─────────────────────────────────────────────────────────

  const isSearching = searchQuery.trim().length > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div data-dbg="jobs-view" className="contents">
        <JobHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onOpenBlankSchedule={handleOpenBlank}
          onOpenTemplate={handleOpenTemplate}
        />

        <div data-dbg="jobs-view-list" className="flex-1 min-h-0 overflow-hidden">
          {filteredJobs.length === 0 && !isSearching && (
            <div
              data-dbg="jobs-empty"
              className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center"
            >
              <p className="m-0 text-sm font-medium text-content">No schedules yet</p>
              <small className="text-[11px] leading-normal text-[#6C6C70] max-w-70">
                Add a schedule to send a prompt to this agent on a recurring or one-time basis.
                Scheduled runs require the app and machine to stay awake.
              </small>
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenBlank}
              >
                <Plus size={14} />
                <span>New schedule</span>
              </Button>
            </div>
          )}

          {filteredJobs.length === 0 && isSearching && (
            <div className="flex items-center justify-center p-2 text-[#9E9E9E] text-[12px]">
              {`No schedules match "${searchQuery.trim()}"`}
            </div>
          )}

          {filteredJobs.length > 0 && (
            <div className="flex flex-col gap-0.5 py-1">
              {filteredJobs.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  runCount={runsByJob.get(job.id)?.length ?? 0}
                  onActivate={() => handleActivate(job)}
                  onToggleEnabled={(enabled) => handleToggle(job.id, enabled)}
                  onEdit={() => handleEdit(job)}
                  onRunNow={() => handleRunNow(job)}
                  onDelete={() => handleRequestDelete(job)}
                />
              ))}
            </div>
          )}
        </div>

        <ScheduleOverlay
          open={overlayOpen}
          onOpenChange={(open) => {
            setOverlayOpen(open);
            if (!open) {
              setEditingJob(null);
              setTemplateValues(undefined);
            }
          }}
          defaultAgentId={agentId}
          editingJob={editingJob}
          initialValues={templateValues}
        />

        <AlertDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDelete
                  ? `"${pendingDelete.name}" will be removed. Past run sessions are kept.`
                  : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-sc-destructive text-sc-destructive-foreground hover:bg-sc-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
};

export default JobsView;
