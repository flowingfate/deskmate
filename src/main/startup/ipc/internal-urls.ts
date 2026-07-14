/**
 * Internal URL IPC —— renderer-facing 路径解析。
 *
 * Handler 透传 `InternalUrlRouter.resolveToPath`,profile 走 active,agent/session
 * 由 caller 传入。不暴露 sessionId 给 `knowledge://`(handler 自己不消费)。
 */
import { ipcMain } from 'electron';

import { renderToMain } from '@shared/ipc/internalUrls';
import { Profiles } from '@main/persist';
import { InternalUrlRouter } from '@main/pi';
import { log } from '@main/log';

const logger = log.child({ mod: 'InternalUrlsIpc' });

export default function handleInternalUrlsIPC(): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.resolveToPath(async (_e, input) => {
    try {
      const profile = await Profiles.get().active();
      // `knowledge://` 不消费 sessionId,这里塞空串让 ctx 类型签名满足即可 ——
      // handler 自己只在 `local://` 路径上读 sessionId,无 session 上下文时塞
      // 空串相当于"renderer 没给 session";`local://` handler 会因取不到
      // session 友好报错。
      const ctx = {
        profileId: profile.id,
        agentId: input.agentId,
        sessionId: input.sessionId ?? '',
      };
      const absolutePath = await InternalUrlRouter.get().resolveToPath(input.uri, ctx);
      return { ok: true as const, absolutePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug({ msg: 'resolveToPath failed', err: message, uri: input.uri });
      return { ok: false as const, error: message };
    }
  });
}
