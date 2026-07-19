/**
 * Internal URL IPC —— renderer-facing 路径解析。
 *
 * Handler 透传 `InternalUrlRouter.resolveToPath`，Profile 从 IPC sender 所属窗口解析；
 * renderer 只传 agent / session 上下文。
 */
import { ipcMain } from 'electron';

import { renderToMain } from '@shared/ipc/internalUrls';
import { InternalUrlRouter, type ResolveContext } from '@main/pi';
import { log } from '@main/log';
import { requireProfileForSender } from './profileContext';

const logger = log.child({ mod: 'InternalUrlsIpc' });

export default function handleInternalUrlsIPC(): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.resolveToPath(async (event, input) => {
    try {
      const profile = requireProfileForSender(event);
      // `knowledge://` 不消费 sessionId,这里塞空串让 ctx 类型签名满足即可 ——
      // handler 自己只在 `local://` 路径上读 sessionId,无 session 上下文时塞
      // 空串相当于"renderer 没给 session";`local://` handler 会因取不到
      // session 友好报错。
      const ctx: ResolveContext = {
        mode: 'agent',
        profile,
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
