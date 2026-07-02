import React, { useCallback, useMemo, useState } from 'react';
import { CalendarClock, Loader2, Play, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { Button } from '@/shadcn/button';

import { useCurrentAgentId } from '../../../lib/chat/agentSessionCacheManager';
import { describeCronExpression } from '../../../lib/scheduler/cronDescriptions';
import { runScheduleNow } from '../../../lib/scheduler/showScheduledRunStartedToast';
import { useToast } from '../../ui/ToastProvider';

import { useSchedules, useSchedulesHydrated } from '@/states/schedules.atom';

interface GeneratedScheduleCardsProps {
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

export const GeneratedScheduleCards: React.FC<GeneratedScheduleCardsProps> = ({ scheduleIds }) => {
  const navigate = useNavigate();
  const { showToast, showSuccess, showError } = useToast();
  const currentAgentId = useCurrentAgentId();
  const allJobs = useSchedules();
  const hydrated = useSchedulesHydrated();
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const effectiveAgentId = currentAgentId || undefined;

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
    <div className="message-schedule-cards">
      {normalizedScheduleIds.map((scheduleId) => {
        const job = jobsById[scheduleId];
        const isRunning = runningJobId === scheduleId;

        return (
          <div key={scheduleId} className="message-schedule-card">
            <div className="message-schedule-card-header">
              <div className="message-schedule-card-title-group">
                <span className="message-schedule-card-icon">
                  <CalendarClock size={18} strokeWidth={1.8} />
                </span>
                <div className="message-schedule-card-copy">
                  <span className="message-schedule-card-label">Schedule</span>
                  <span className="message-schedule-card-title">{job?.name || 'Scheduled task'}</span>
                </div>
              </div>
              {!hydrated && !job && (
                <Loader2 size={14} className="message-schedule-card-loading" />
              )}
            </div>

            <div className="message-schedule-card-body">
              <div className="message-schedule-card-row">
                <span className="message-schedule-card-row-label">Runs</span>
                <span className="message-schedule-card-row-value">{formatRunSummary(job)}</span>
              </div>
              <div className="message-schedule-card-row">
                <span className="message-schedule-card-row-label">Job ID</span>
                <span className="message-schedule-card-id">{scheduleId}</span>
              </div>
            </div>

            <div className="message-schedule-card-actions">
              <Button
                variant="ghost"
                size="icon"
                className="message-schedule-card-button secondary"
                onClick={() => handleRunNow(scheduleId)}
                disabled={isRunning || !job}
              >
                {isRunning ? <Loader2 size={14} className="message-schedule-card-button-spinner" /> : <Play size={14} strokeWidth={2} />}
                Run now
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="message-schedule-card-button primary"
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
