import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { Context } from './shared';
import { Profiles } from '@main/persist';
import { PERSIST_PATH, MONTH_KEY } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';
import { extractMonthFromChatSessionIdValue } from '@shared/utils/idFormats';
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
      const profileId = Profiles.get().activeProfileId;
      if (!profileId) {
        return { success: false, error: 'No active profile' };
      }
      const month = extractMonthFromChatSessionIdValue(sessionId);
      if (!month) {
        return { success: false, error: `Invalid sessionId format: ${sessionId}` };
      }
      const dirPath = PERSIST_PATH.sessionDir(getAppRoot(), profileId, agentId, month, sessionId);
      return { success: true, filePath: dirPath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
