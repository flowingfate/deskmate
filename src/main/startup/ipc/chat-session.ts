import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { Context } from './shared';
import { queryJobRun, querySession } from '@main/persist/ipc';
import type { ChatSessionFile } from '@shared/persist/types'
import { renderToMain } from '@shared/ipc/chatSession';

type DownloadableSession = {
  id: string;
  title: string;
  config: { updatedAt: string; contextState: ChatSessionFile['contextState'] };
  loadMessagesAll(): Promise<ChatSessionFile['messages']>;
};

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
    _event,
    agentId,
    sessionId,
    title
  ) => {
    try {
      const query = await querySession(agentId, sessionId);
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
  handle.downloadScheduleRun(async (_event, agentId, jobId, runId, title) => {
    try {
      const query = await queryJobRun(agentId, jobId, runId);
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
    _event,
    agentId,
    sessionId,
  ) => {
    try {
      const query = await querySession(agentId, sessionId);
      if (!query.success) return query;
      return { success: true, filePath: path.dirname(query.session.filesDir()) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
  handle.getScheduleRunFilePath(async (_event, agentId, jobId, runId) => {
    try {
      const query = await queryJobRun(agentId, jobId, runId);
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
