import { mainWindowForProfile } from '@main/startup/wins';
import { mainToRender, type MainToRender } from '@shared/ipc/persist';

/**
 * Persist → renderer 广播入口。store 写路径在 source + index 都落盘后调它。
 *
 * 没 main window（启动早期 / window 已关 / 测试 / CLI demo）→ silent no-op，
 * 不让 emit 失败阻塞写盘。
 */
export function emit<K extends keyof MainToRender>(
  profileId: string,
  channel: K,
  payload: MainToRender[K],
): void {
  mainWindowForProfile(profileId, (win) => {
    mainToRender.bindWebContents(win.webContents)[channel](payload);
  });
}
