import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { Context } from './shared';
import { Profiles } from '@main/persist';
import type { ChatSessionFile } from '@shared/persist/types'
import { renderToMain } from '@shared/ipc/chatSession';

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
      const profile = await Profiles.get().active();
      const persistAgent = await profile.getAgent(agentId);
      if (!persistAgent) {
        return { success: false, error: 'Agent not found' };
      }
      const session = await persistAgent.getSession(sessionId);
      if (!session) {
        return { success: false, error: 'Chat session not found' };
      }
      const messages = await session.loadMessagesAll();
      const file: ChatSessionFile = {
        chatSession_id: session.id,
        title: session.title,
        last_updated: session.config.updatedAt,
        messages,
        contextState: session.config.contextState,
      };

      const downloadsDir = app.getPath('downloads');

      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').trim() || sessionId;
      let destFileName = `${safeTitle}.json`;
      let destPath = path.join(downloadsDir, destFileName);

      if (fs.existsSync(destPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        destFileName = `${safeTitle}_${timestamp}.json`;
        destPath = path.join(downloadsDir, destFileName);
      }

      await fs.promises.writeFile(destPath, JSON.stringify(file, null, 2), 'utf-8');

      return { success: true, filePath: destPath, fileName: destFileName };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download chat session'
      };
    }
  });

  handle.getFilePath(async (
    _event,
    agentId,
    sessionId,
  ) => {
    try {
      const profile = await Profiles.get().active();
      const agent = await profile.getAgent(agentId);
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      const session = await agent.getSession(sessionId);
      if (!session) {
        return { success: false, error: 'Chat session not found' };
      }

      return { success: true, filePath: path.dirname(session.filesDir()) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
