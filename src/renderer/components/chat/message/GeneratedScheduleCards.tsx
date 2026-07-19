import React, { useCallback, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Play, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { Button } from '@/shadcn/button';

import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions';
import { runScheduleNow } from '../../../lib/scheduler/showScheduledRunStartedToast';
import { useToast } from '../../ui/ToastProvider';

import { useSchedules, useSchedulesHydrated } from '@/states/schedules.atom';

interface GeneratedScheduleCardsProps {
  agentId: string;
  scheduleIds: string[];
}

const formatRunSummary = (job: SchedulerJob | undefined): string => {
  if (!job) {
    return 'Schedule found in response';
  }

  if (job.scheduleType === 'once' && job.runAt) {
    const timestamp = Date.parse(job.runAt);
    if (!Number.isNaN(timestamp)) {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(timestamp));
    }
  }

  if (job.scheduleType === 'cron' && job.cronExpression) {
    return describeCronExpression(job.cronExpression);
  }

  return 'Schedule found in response';
};

export const GeneratedScheduleCards: React.FC<GeneratedScheduleCardsProps> = ({ agentId, scheduleIds }) => {
  const navigate = useNavigate();
  const { showToast, showSuccess, showError } = useToast();
  const allJobs = useSchedules();
  const hydrated = useSchedulesHydrated();
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const effectiveAgentId = agentId;

  const normalizedScheduleIds = useMemo(
    () => Array.from(new Set(scheduleIds.map((scheduleId) => scheduleId.trim()).filter(Boolean))),
    [scheduleIds],
  );

  const jobsById = useMemo<Record<string, SchedulerJob>>(() => {
    const out: Record<string, SchedulerJob> = {};
    for (const job of allJobs) {
      if (normalizedScheduleIds.includes(job.id)) {
        out[job.id] = job;
      }
    }
    return out;
  }, [allJobs, normalizedScheduleIds]);

  const handleRunNow = useCallback(async (jobId: string) => {
    const job = jobsById[jobId];
    if (!job) return;
    setRunningJobId(jobId);
    await runScheduleNow(job.agentId, jobId, navigate, showToast, showSuccess, showError);
    setRunningJobId((current) => (current === jobId ? null : current));
  }, [jobsById, navigate, showError, showSuccess, showToast]);

  const handleManage = useCallback((jobId: string) => {
    const job = jobsById[jobId];
    const targetAgent = job?.agentId || effectiveAgentId;
    if (!targetAgent) {
      showError('Unable to open schedules for this chat.');
      return;
    }
    navigate(`/agent/${targetAgent}/job/${jobId}`);
  }, [effectiveAgentId, jobsById, navigate, showError]);

  if (normalizedScheduleIds.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5 w-full max-w-[min(100%,420px)]">
      {normalizedScheduleIds.map((scheduleId) => {
        const job = jobsById[scheduleId];
        const isRunning = runningJobId === scheduleId;

        return (
          <div
            key={scheduleId}
            className="flex flex-col gap-3 px-4 py-3.5 border border-[rgba(214,196,174,0.8)] rounded-[14px] bg-[linear-gradient(180deg,rgba(249,244,238,0.98)_0%,rgba(255,252,248,0.98)_100%)] shadow-[0_8px_20px_rgba(39,35,32,0.06)]"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex items-center justify-center w-8.5 h-8.5 rounded-[10px] bg-[rgba(39,35,32,0.08)] text-[#272320] shrink-0">
                  <CalendarClock size={18} strokeWidth={1.8} />
                </span>
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] leading-[1.4] tracking-[0.04em] uppercase text-[#8a6f54]">Schedule</span>
                  <span className="text-sm leading-[1.4] font-semibold text-[#272320] truncate">{job?.name || 'Scheduled task'}</span>
                </div>
              </div>
              {!hydrated && !job && (
                <Loader2 size={14} className="animate-spin" />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] leading-[1.4] uppercase tracking-[0.04em] text-[#8a6f54]">Runs</span>
                <span className="text-[13px] leading-normal text-[#3d3a36]">{formatRunSummary(job)}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] leading-[1.4] uppercase tracking-[0.04em] text-[#8a6f54]">Job ID</span>
                <span className="inline-flex w-fit max-w-full px-2 py-1 rounded-lg bg-[rgba(214,196,174,0.55)] text-[#4c4137] text-xs leading-[1.4] font-mono wrap-anywhere">{scheduleId}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="icon"
                className="inline-flex items-center justify-center gap-1.5 min-h-8 w-auto px-3 py-2 rounded-[9px] border border-[rgba(39,35,32,0.14)] text-xs font-semibold bg-white/90 text-[#272320] transition-colors [&:hover:not(:disabled)]:bg-white [&:hover:not(:disabled)]:border-[rgba(39,35,32,0.24)] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleRunNow(scheduleId)}
                disabled={isRunning || !job}
              >
                {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} strokeWidth={2} />}
                Run now
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="inline-flex items-center justify-center gap-1.5 min-h-8 w-auto px-3 py-2 rounded-[9px] border border-[#272320] text-xs font-semibold bg-[#272320] text-white transition-colors [&:hover:not(:disabled)]:bg-[#3d3a36] [&:hover:not(:disabled)]:border-[#3d3a36] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleManage(scheduleId)}
                disabled={!job && !effectiveAgentId}
              >
                <Settings2 size={14} strokeWidth={2} />
                Manage
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default GeneratedScheduleCards;
