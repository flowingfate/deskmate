import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { Context } from './shared';
import type { ProfileStore } from '@main/persist';
import type { ChatSessionFile } from '@shared/persist/types'
import { renderToMain } from '@shared/ipc/chatSession';
import { requireProfileForSender } from './profileContext';

type DownloadableSession = {
  id: string;
  title: string;
  config: { updatedAt: string; contextState: ChatSessionFile['contextState'] };
  loadMessagesAll(): Promise<ChatSessionFile['messages']>;
};

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
  session: DownloadableSession,
  title: string,
): Promise<{ filePath: string; fileName: string }> {
  const file: ChatSessionFile = {
    chatSession_id: session.id,
    title: session.title,
    last_updated: session.config.updatedAt,
    messages: await session.loadMessagesAll(),
    contextState: session.config.contextState,
  };
  const downloadsDir = app.getPath('downloads');
  const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').trim() || session.id;
  let fileName = `${safeTitle}.json`;
  let filePath = path.join(downloadsDir, fileName);

  if (fs.existsSync(filePath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fileName = `${safeTitle}_${timestamp}.json`;
    filePath = path.join(downloadsDir, fileName);
  }

  await fs.promises.writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8');
  return { filePath, fileName };
}

export default function handleChatSessionIPC(_ctx: Context): void {
  const handle = renderToMain.bindMain(ipcMain);

  // Download ChatSession to Downloads directory
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
