import * as cron from 'node-cron';
import type { SchedulerJob } from '@shared/ipc/scheduler';

export type ActiveTask =
  | { kind: 'cron'; task: cron.ScheduledTask }
  | { kind: 'timeout'; timer: NodeJS.Timeout };

export type SchedulerTaskRuntimeMeta = {
  jobId: string;
  profileId: string;
  schedulerGeneration: number;
  taskSequence: number;
  taskKind: ActiveTask['kind'];
  registeredAt: string;
  cronExpression?: string;
  runAt?: string;
  lastTickArrivedAt?: string;
  lastCronWatchdogCheckedAt?: string;
  lastCronWatchdogCatchUpAt?: string;
  lastExecuteStartAt?: string;
  lastExecuteEndAt?: string;
  lastExecuteOutcome?: 'success' | 'failed';
};

export type SchedulerExecutionResult = {
  success: boolean;
  chatSessionId?: string;
  messagesCount?: number;
  error?: string;
};
export type SchedulerJobExecution = {
  job: SchedulerJob;
  triggerSource: SchedulerTriggerSource;
  expectedGeneration?: number;
};

export type SchedulerJobExecutor = (
  execution: SchedulerJobExecution,
) => Promise<SchedulerExecutionResult>;

export type SchedulerDisposeReason =
  | 'app-quit'
  | 'updater-handoff'
  | 'manual-debug'
  | 'unknown';

export type SchedulerTaskUnregisterReason =
  | 're-register-before-cron-register'
  | 're-register-before-once-register'
  | 'start-clear'
  | 'dispose'
  | 'app-quit'
  | 'updater-handoff'
  | 'toggle-disable'
  | 'toggle-enable-replace-existing'
  | 'update-job'
  | 'delete-job'
  | 'once-job-fired'
  | 'once-job-completed'
  | 'once-job-failed'
  | 'once-job-expired'
  | 'profile-start-failed'
  | 'profile-dispose'
  | 'manual-debug'
  | 'unknown';

export type SchedulerTriggerSource =
  | 'scheduled'
  | 'manual'
  | 'resume-catchup'
  | 'cold-start-catchup'
  | 'watchdog-catchup';

export type SchedulerRuntimeDiagnostics = {
  profileId: string;
  schedulerGeneration: number;
  activeTaskCount: number;
  activeJobIds: string[];
  taskRuntimeMetaSnapshot: SchedulerTaskRuntimeMeta[];
};
