import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { exportSessionArchive, type ProfileStore, type Session } from '@main/persist';
import { renderToMain } from '@shared/ipc/chatSession';
import { requireProfileForSender } from './profileContext';

async function querySessionForProfile(store: ProfileStore, agentId: string, sessionId: string) {
  const agent = await store.getAgent(agentId);
  if (!agent) return { success: false, error: `Agent not found: ${agentId}` } as const;
  const session = await agent.getSession(sessionId);
  if (!session) return { success: false, error: `Session not found: ${sessionId}` } as const;
  return { success: true, session } as const;
}

async function queryJobRunForProfile(store: ProfileStore, agentId: string, jobId: string, runId: string) {
  const agent = await store.getAgent(agentId);
  if (!agent) return { success: false, error: `Agent not found: ${agentId}` } as const;
  const job = await agent.getJob(jobId);
  if (!job) return { success: false, error: `Job not found: ${jobId}` } as const;
  const run = await job.getRun(runId);
  if (!run) return { success: false, error: `Run not found: ${runId}` } as const;
  return { success: true, run } as const;
}

async function writeSessionDownload(
  session: Session,
  title: string,
): Promise<{ filePath: string; fileName: string }> {
  const downloadsDir = app.getPath('downloads');
  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').trim() || session.id;
  let fileName = `${safeTitle}.zip`;
  let filePath = path.join(downloadsDir, fileName);

  if (fs.existsSync(filePath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fileName = `${safeTitle}_${timestamp}.zip`;
    filePath = path.join(downloadsDir, fileName);
  }

  await exportSessionArchive(session, filePath);
  return { filePath, fileName };
}

export default function handleChatSessionIPC(): void {
  const handle = renderToMain.bindMain(ipcMain);

  // Download the complete session directory as a ZIP archive
  handle.downloadChatSession(async (
    event,
    agentId,
    sessionId,
    title,
  ) => {
    try {
      const query = await querySessionForProfile(requireProfileForSender(event).store, agentId, sessionId);
      if (!query.success) return query;
      const download = await writeSessionDownload(query.session, title);
      return { success: true, ...download };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download chat session'
      };
    }
  });
  handle.downloadScheduleRun(async (event, agentId, jobId, runId, title) => {
    try {
      const query = await queryJobRunForProfile(requireProfileForSender(event).store, agentId, jobId, runId);
      if (!query.success) return query;
      const download = await writeSessionDownload(query.run, title);
      return { success: true, ...download };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download schedule run',
      };
    }
  });

  handle.getFilePath(async (
    event,
    agentId,
    sessionId,
  ) => {
    try {
      const query = await querySessionForProfile(requireProfileForSender(event).store, agentId, sessionId);
      if (!query.success) return query;
      return { success: true, filePath: path.dirname(query.session.filesDir()) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  handle.getScheduleRunFilePath(async (event, agentId, jobId, runId) => {
    try {
      const query = await queryJobRunForProfile(requireProfileForSender(event).store, agentId, jobId, runId);
      if (!query.success) return query;
      return { success: true, filePath: path.dirname(query.run.filesDir()) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
