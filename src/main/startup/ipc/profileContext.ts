import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { ProfileRegistry } from '@main/profileRegistry';
import type { Profile } from '@main/profile';
import { getWindowMeta } from '@main/startup/wins';

/**
 * 将 renderer IPC 精确路由到发起窗口在创建时绑定的 Profile。
 *
 * profileId 绝不从 renderer 参数或 `defaultProfileId` 推断：两者在多主窗口下都不可靠。
 */
export function requireProfileForSender(event: IpcMainInvokeEvent): Profile {
  const window = BrowserWindow.fromWebContents(event.sender);
  const profileId = window ? getWindowMeta(window)?.profileId : undefined;
  if (!profileId) {
    throw new Error('Profile-scoped IPC requires a profile-bound main window.');
  }
  return ProfileRegistry.require(profileId);
}
