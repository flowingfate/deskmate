import { BrowserWindow, Notification } from 'electron';

import { APP_NAME } from '@shared/constants/branding';
import { mainToRender as navigateMainToRender } from '@shared/ipc/navigate';
import { mainToRender as notificationMainToRender } from '@shared/ipc/notification';

import { log } from '@main/log';
import { mainWindowForProfile } from '@main/startup/wins';

const logger = log;

/**
 * schedule job / schedule_run 完成时的完成提示入口。
 *
 * 分流策略（macOS 会静默丢弃「前台 App 自己发的系统通知」，横幅弹不出来）：
 *   - owning Profile 主窗口存在且处于前台聚焦 → 走 IPC 让该 renderer 弹 in-app toast；
 *   - 否则 → 回落系统级通知；点击时只查找 owning Profile 窗口，不向其他窗口 fallback。
 * 本模块不依赖 chat engine，窗口选址严格使用创建任务时绑定的 profileId。
 */

const activeNotifications = new Map<string, Notification>();

export type SessionCompletionOutcome = 'completed' | 'failed';

export interface SessionCompletionArgs {
  profileId: string;
  agentId: string;
  jobId: string;
  sessionId: string;
  sessionTitle?: string | null;
  outcome: SessionCompletionOutcome;
}

export function showSessionCompletionNotification(args: SessionCompletionArgs): void {
  const win = mainWindowForProfile(args.profileId);
  const foreground =
    win != null && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();

  if (foreground) {
    const delivered = showInAppToast(win, args);
    if (delivered) return;
    // toast 派发失败（webContents 已销毁等）→ 回落系统通知
  }
  showSystemNotification(args);
}

/**
 * 主窗口前台可见时，走 IPC 让 renderer 弹 in-app toast。
 * 返回是否成功派发（webContents 不可用时返回 false，交由调用方回落）。
 */
function showInAppToast(win: BrowserWindow, args: SessionCompletionArgs): boolean {
  const { profileId, agentId, jobId, sessionId, sessionTitle, outcome } = args;
  const wc = win.webContents;
  if (wc.isDestroyed()) return false;
  try {
    notificationMainToRender.bindWebContents(wc).sessionCompletion({ agentId, jobId, sessionId, sessionTitle, outcome });
    logger.info({ msg: 'sessionCompletion.toast.sent', mod: 'showSessionCompletionNotification', profileId, agentId, jobId, sessionId, outcome });
    return true;
  } catch (error) {
    logger.warn({ msg: 'sessionCompletion.toast.failed', mod: 'showSessionCompletionNotification', profileId, agentId, sessionId, outcome, err: error });
    return false;
  }
}

function showSystemNotification(args: SessionCompletionArgs): void {
  const { profileId, agentId, jobId, sessionId, sessionTitle, outcome } = args;
  if (!Notification.isSupported()) {
    return;
  }

  const name = sessionTitle?.trim() || sessionId;
  const body = outcome === 'failed'
    ? `#${name}# failed, click to view`
    : `#${name}# is complete, click to view`;

  try {
    const notification = new Notification({ title: APP_NAME, body });
    const notificationId = `${profileId}_${sessionId}_${Date.now()}`;

    const cleanup = () => {
      activeNotifications.delete(notificationId);
    };

    notification.on('click', () => {
      cleanup();
      const target = mainWindowForProfile(profileId);
      if (!target) return;
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
      navigateMainToRender.bindWebContents(target.webContents).to({
        route: `/agent/${agentId}/job/${jobId}/${sessionId}`,
      });
    });

    notification.on('close', cleanup);

    activeNotifications.set(notificationId, notification);
    notification.show();
    logger.info({ msg: 'sessionCompletion.notification.sent', mod: 'showSessionCompletionNotification', profileId, agentId, sessionId, outcome });
  } catch (error) {
    logger.warn({ msg: 'sessionCompletion.notification.failed', mod: 'showSessionCompletionNotification', profileId, agentId, sessionId, outcome, err: error });
  }
}
