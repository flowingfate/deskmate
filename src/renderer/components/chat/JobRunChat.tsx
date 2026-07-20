import { ArrowRight, LockKeyhole } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '@/components/ui/ToastProvider';
import { persistApi } from '@/ipc/persist';
import { useAgentScheduleRuns } from '@renderer/states/scheduleRuns.atom';
import { Button } from '@/shadcn/button';
import { EMPTY_MESSAGE } from './zero/illustrarion';


interface JobRunComposerProps {
  agentId: string;
  jobId: string | null;
  sessionId: string | null;
}

export function JobRunComposer({ agentId, jobId, sessionId }: JobRunComposerProps): ReactElement {
  const [isConverting, setIsConverting] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const runs = useAgentScheduleRuns(agentId);
  const run = runs.find((item) => item.id === sessionId && item.jobId === jobId);

  const hasJobRun = Boolean(jobId && sessionId);
  const isRunning = run?.runStatus === 'running';

  async function handleConvertToRegularSession(): Promise<void> {
    if (!jobId || !sessionId || isConverting || isRunning) return;

    setIsConverting(true);
    try {
      const result = await persistApi.forkJobRunToSession(agentId, jobId, sessionId);
      if (!result.success) {
        toast.showError(result.error);
        return;
      }
      const newSessionId = result.data?.sessionId;
      if (!newSessionId) {
        toast.showError('Unable to create a continuation session');
        return;
      }
      toast.showSuccess('Created a regular session from this scheduled run');
      navigate(`/agent/${agentId}/${newSessionId}`);
    } catch {
      toast.showError('Unable to create a continuation session');
    } finally {
      setIsConverting(false);
    }
  }

  return (
    <aside
      aria-label="Scheduled run controls"
      className="border-t border-sc-border bg-sc-background px-4 py-3"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-sc-muted text-sc-muted-foreground">
            <LockKeyhole size={16} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-sc-foreground">Scheduled run · Read-only</p>
            <p className="text-sm leading-5 text-sc-muted-foreground">
              {hasJobRun
                ? isRunning
                  ? 'Wait for this run to finish before converting it.'
                  : 'This run is read-only. You can convert it to a regular session to continue the work.'
                : 'No run session selected.'}
            </p>
          </div>
        </div>
        <Button
          className="shrink-0 gap-2"
          size="sm"
          disabled={!hasJobRun || isConverting || isRunning}
          onClick={() => handleConvertToRegularSession()}
        >
          <ArrowRight size={12} aria-hidden="true" />
          Convert
        </Button>
      </div>
    </aside>
  );
}

export function JobRunEmptyContent(): ReactElement {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex size-30 items-center justify-center text-sc-muted-foreground">
          {EMPTY_MESSAGE}
        </div>
        <h2 className="mt-4 text-base font-semibold text-sc-foreground">
          Empty conversation
        </h2>
        <p className="text-sm leading-6 text-sc-muted-foreground">
          Choose a run session to review its history.
        </p>
      </div>
    </section>
  );
}
