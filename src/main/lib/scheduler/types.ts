import * as cron from 'node-cron';

export type ActiveTask =
  | { kind: 'cron'; task: cron.ScheduledTask }
  | { kind: 'timeout'; timer: NodeJS.Timeout };

export type SchedulerTaskRuntimeMeta = {
  jobId: string;
  profileId: string | null;
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

export type SchedulerDisposeReason =
  | 'app-quit'
  | 'updater-handoff'
  | 'manual-debug'
  | 'unknown';

export type SchedulerTaskUnregisterReason =
  | 're-register-before-cron-register'
  | 're-register-before-once-register'
  | 'initialize-clear'
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
  | 'profile-switch'
  | 'manual-debug'
  | 'unknown';

export type SchedulerTriggerSource =
  | 'scheduled'
  | 'manual'
  | 'resume-catchup'
  | 'cold-start-catchup'
  | 'watchdog-catchup';

export type SchedulerRuntimeDiagnostics = {
  profileId: string | null;
  schedulerGeneration: number;
  activeTaskCount: number;
  activeJobIds: string[];
  taskRuntimeMetaSnapshot: SchedulerTaskRuntimeMeta[];
};
