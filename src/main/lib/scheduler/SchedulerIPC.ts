import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/scheduler';
import { Profiles } from '@main/persist';
import { schedulerManager } from './SchedulerManager';

let isRegistered = false;

export const registerSchedulerIPC = (): void => {
  if (isRegistered) return;

  const handle = renderToMain.bindMain(ipcMain);

  handle.listJobs(async () => {
    try {
      const jobs = await schedulerManager.listJobs();
      return { success: true, data: jobs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.createJob(async (_event, job) => {
    try {
      const jobId = await schedulerManager.createJob(job);
      return { success: true, data: { jobId } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.deleteJob(async (_event, jobId) => {
    try {
      const success = await schedulerManager.deleteJob(jobId);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.toggleJob(async (_event, jobId, enabled) => {
    try {
      const success = await schedulerManager.toggleJob(jobId, enabled);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.updateJob(async (_event, jobId, updates) => {
    try {
      const success = await schedulerManager.updateJob(jobId, updates);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.runJobNow(async (_event, jobId) => {
    try {
      const result = await schedulerManager.runJobNow(jobId);
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to run schedule' };
      }

      return {
        success: true,
        data: {
          chatSessionId: result.chatSessionId,
          messagesCount: result.messagesCount,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.getJobSessions(async (_event, jobId) => {
    try {
      // step5 PR4：直接走 persist 列 job 历史 run。lightweight summary（不开 messages.jsonl）。
      const profile = await Profiles.get().active();
      const hit = await profile.findJob(jobId);
      if (!hit) {
        return { success: false, error: 'Job not found' };
      }
      const runs = await hit.job.listRunsOnDisk();
      const data = runs.map((r) => ({
        chatSession_id: r.id,
        title: r.title || r.id,
        last_updated: r.finishedAt ?? r.startedAt,
      }));
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  isRegistered = true;
};
