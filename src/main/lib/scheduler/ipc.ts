import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/scheduler';
import type { SchedulerManager } from './manager';
import { requireProfileForSender } from '@main/startup/ipc/profileContext';

function schedulerForSender(event: Electron.IpcMainInvokeEvent): SchedulerManager {
  return requireProfileForSender(event).scheduler;
}

let isRegistered = false;

export const registerSchedulerIPC = (): void => {
  if (isRegistered) return;

  const handle = renderToMain.bindMain(ipcMain);

  handle.listJobs(async (event) => {
    try {
      const jobs = await schedulerForSender(event).listJobs();
      return { success: true, data: jobs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.createJob(async (event, job) => {
    try {
      const jobId = await schedulerForSender(event).createJob(job);
      return { success: true, data: { jobId } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.deleteJob(async (event, jobId) => {
    try {
      const success = await schedulerForSender(event).deleteJob(jobId);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.toggleJob(async (event, jobId, enabled) => {
    try {
      const success = await schedulerForSender(event).toggleJob(jobId, enabled);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.updateJob(async (event, jobId, updates) => {
    try {
      const success = await schedulerForSender(event).updateJob(jobId, updates);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.runJobNow(async (event, jobId, force) => {
    try {
      const result = await schedulerForSender(event).runJobNow(jobId, force);
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


  isRegistered = true;
};
