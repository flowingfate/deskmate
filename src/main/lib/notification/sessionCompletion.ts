import { BrowserWindow, Notification } from 'electron';

import { APP_NAME } from '@shared/constants/branding';
import { mainToRender as navigateMainToRender } from '@shared/ipc/navigate';

import { log } from '@main/log';
import { mainWindow, anyVisibleWindow } from '@main/startup/wins';

const logger = log;

/**
 * 给一次 schedule_run / job 完成发系统通知 + 注册点击跳转到对应 session。
 * 旧实现挂在 agentChatManagerNotificationBridge.ts 上；本模块独立出来，不依赖
 * chat engine，主窗口引用走 wins.mainWindow() 全局注册表。
 */

const activeNotifications = new Map<string, Notification>();

export type SessionCompletionOutcome = 'completed' | 'failed';

export function showSessionCompletionNotification(args: {
  agentId: string;
  sessionId: string;
  sessionTitle?: string | null;
  outcome: SessionCompletionOutcome;
}): void {
  const { agentId, sessionId, sessionTitle, outcome } = args;

  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return;
  }
  if (!Notification.isSupported()) {
    return;
  }

  const name = sessionTitle?.trim() || sessionId;
  const body = outcome === 'failed'
    ? `#${name}# failed, click to view`
    : `#${name}# is complete, click to view`;

  try {
    const notification = new Notification({ title: APP_NAME, body });
    const notificationId = `${sessionId}_${Date.now()}`;

    const cleanup = () => {
      activeNotifications.delete(notificationId);
    };

    notification.on('click', () => {
      cleanup();
      const target = pickNotificationWindow();
      if (!target) return;
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
      navigateMainToRender.bindWebContents(target.webContents).to({
        route: `/agent/${agentId}/${sessionId}`,
        state: {
          source: 'system-notification',
          intent: 'open-session',
          targetAgentId: agentId,
          targetSessionId: sessionId,
        },
      });
    });

    notification.on('close', cleanup);

    activeNotifications.set(notificationId, notification);
    notification.show();
    logger.info({ msg: 'sessionCompletion.notification.sent', mod: 'showSessionCompletionNotification', agentId, sessionId, outcome });
  } catch (error) {
    logger.warn({ msg: 'sessionCompletion.notification.failed', mod: 'showSessionCompletionNotification', agentId, sessionId, outcome, err: error });
  }
}

function pickNotificationWindow(): BrowserWindow | null {
  return mainWindow() ?? anyVisibleWindow();
}
