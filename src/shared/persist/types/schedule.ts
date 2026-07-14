/** `agents/{a_id}/schedules/jobs.json`。 */
export interface ScheduleJobsIndexFile {
  version: 1;
  items: ScheduleJobIndexEntry[];
}

interface ScheduleJobIndexEntryBase {
  id: string;
  name: string;
  enabled: boolean;
  runState: JobRunState;
}

export interface OnceScheduleJobIndexEntry extends ScheduleJobIndexEntryBase {
  scheduleType: 'once';
  runAt: string;
}

export interface CronScheduleJobIndexEntry extends ScheduleJobIndexEntryBase {
  scheduleType: 'cron';
  cron: string;
}

export type ScheduleJobIndexEntry = OnceScheduleJobIndexEntry | CronScheduleJobIndexEntry;

/** job 的运行状态：pending → running → (completed | failed)。 */
export type JobRunState =
  | { status: 'pending' }
  | { status: 'running'; startedAt: string }
  | { status: 'completed'; startedAt: string; finishedAt: string }
  | { status: 'failed'; startedAt: string; finishedAt: string; error: string };

interface ScheduleJobFileBase {
  version: 1;
  id: string;
  agentId: string;
  name: string;
  description?: string;
  message: string;
  enabled: boolean;
  notifyOnCompletion?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `agents/{a_id}/schedules/{j_id}/job.json` 的 once 形态。 */
export interface OnceScheduleJobFile extends ScheduleJobFileBase {
  scheduleType: 'once';
  runAt: string;
}

/** `agents/{a_id}/schedules/{j_id}/job.json` 的 cron 形态。 */
export interface CronScheduleJobFile extends ScheduleJobFileBase {
  scheduleType: 'cron';
  cron: string;
}

export type ScheduleJobFile = OnceScheduleJobFile | CronScheduleJobFile;

/** `scheduler-state.json` 冷启动补跑队列的单项。 */
export interface PendingColdStartCatchUp {
  occurrenceAt: string;
  recordedAt: string;
}

/** `scheduler-state.json`。 */
export interface SchedulerStateFile {
  version: 1;
  isActive: boolean;
  lastActivatedAt?: string;
  lastDeactivatedAt?: string;
  pendingColdStartCatchUps?: Record<string, PendingColdStartCatchUp>;
}
