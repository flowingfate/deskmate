import { mainWindow } from '@main/startup/wins';
import { mainToRender, type MainToRender } from '@shared/ipc/persist';

/**
 * Persist → renderer 广播入口。store 写路径在 source + index 都落盘后调它。
 *
 * 没 main window（启动早期 / window 已关 / 测试 / CLI demo）→ silent no-op，
 * 不让 emit 失败阻塞写盘。
 */
export function emit<K extends keyof MainToRender>(channel: K, payload: MainToRender[K]): void {
  const wc = mainWindow()?.webContents;
  if (!wc) return;
  mainToRender.bindWebContents(wc)[channel](payload);
}
