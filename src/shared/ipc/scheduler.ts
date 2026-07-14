import { connectRenderToMain } from './base';

type SchedulerJobBase = {
  id: string;
  description: string;
  name: string;
  enabled: boolean;
  agentId: string;
  message: string;
  /** 最近一次运行开始时间；由 persist 的 runState 投影。 */
  lastStartedAt?: string;
  /** Whether to send a notification on completion. Defaults to true. */
  notifyOnCompletion: boolean;
};

export type SchedulerJob =
  | (SchedulerJobBase & { scheduleType: 'cron'; cronExpression: string })
  | (SchedulerJobBase & { scheduleType: 'once'; runAt: string });

type SchedulerJobMutableFields = Partial<
  Pick<SchedulerJobBase, 'name' | 'description' | 'message' | 'enabled' | 'notifyOnCompletion'>
>;

export type SchedulerJobCreateInput = Omit<SchedulerJobBase, 'id' | 'lastStartedAt'> & (
  | { scheduleType: 'cron'; cronExpression: string }
  | { scheduleType: 'once'; runAt: string }
);

/** Schedule replacement is atomic: switching kind always supplies its new value. */
export type SchedulerJobUpdate = SchedulerJobMutableFields & (
  | { scheduleType?: undefined; cronExpression?: undefined; runAt?: undefined }
  | { scheduleType: 'cron'; cronExpression: string; runAt?: undefined }
  | { scheduleType: 'once'; runAt: string; cronExpression?: undefined }
);

type RenderToMain = {
  listJobs: {
    call: [];
    return: { success: boolean; data?: SchedulerJob[]; error?: string };
  };
  createJob: {
    call: [job: SchedulerJobCreateInput];
    return: { success: boolean; data?: { jobId: string }; error?: string };
  };
  deleteJob: {
    call: [jobId: string];
    return: { success: boolean; error?: string };
  };
  toggleJob: {
    call: [jobId: string, enabled: boolean];
    return: { success: boolean; error?: string };
  };
  updateJob: {
    call: [jobId: string, updates: SchedulerJobUpdate];
    return: { success: boolean; error?: string };
  };
  runJobNow: {
    call: [jobId: string, force?: boolean];
    return: { success: boolean; data?: SchedulerManualRunResult; error?: string };
  };
};

export interface SchedulerManualRunResult {
  chatSessionId?: string;
  messagesCount?: number;
}

export const renderToMain = connectRenderToMain<RenderToMain>('scheduler');
