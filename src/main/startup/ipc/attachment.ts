/**
 * Attachment IPC —— 用户附件落 session sandbox。
 *
 * 不暴露 profile id;handler 内部走 `Profiles.get().active()`。
 * agent / session 任一缺失或抓不到属于 client-side bug —— 返回结构化 error,
 * 不抛(渲染层 alert 即可)。
 */
import { ipcMain } from 'electron';

import { renderToMain } from '@shared/ipc/attachment';
import { Profiles } from '@main/persist';
import { attachFromPath, attachFromBytes } from '@main/lib/attachment';
import { log } from '@main/log';

const logger = log.child({ mod: 'AttachmentIpc' });

export default function handleAttachmentIPC(): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.attachFromPath(async (_e, input) => {
    try {
      const profile = await Profiles.get().active();
      const outcome = await attachFromPath(
        input.srcPath,
        input.originalName,
        { agentId: input.agentId, sessionId: input.sessionId },
        profile.id,
      );
      return {
        success: true,
        data: { uri: outcome.uri, fileName: outcome.fileName, size: outcome.size },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ msg: 'attachFromPath failed', err: message, srcPath: input.srcPath });
      return { success: false, error: message };
    }
  });

  handle.attachFromBytes(async (_e, input) => {
    try {
      const profile = await Profiles.get().active();
      // structured-clone 把 Uint8Array 原样过来,Buffer.from 共享底层 ArrayBuffer 避免拷贝。
      const buf = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
      const outcome = await attachFromBytes(
        buf,
        input.originalName,
        { agentId: input.agentId, sessionId: input.sessionId },
        profile.id,
      );
      return {
        success: true,
        data: { uri: outcome.uri, fileName: outcome.fileName, size: outcome.size },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ msg: 'attachFromBytes failed', err: message, name: input.originalName });
      return { success: false, error: message };
    }
  });
}
