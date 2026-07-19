import { connectMainToRender } from './base';

/**
 * schedule job 完成通知的 Main → Render 通道。
 *
 * 主进程判定 owning Profile 主窗口在前台可见时，走此通道让对应 renderer 弹
 * in-app toast（macOS 会静默丢弃「前台 App 自己发的系统通知」）；owner 窗口
 * 不可见时才回落到 `showSessionCompletionNotification` 的系统级通知。
 */

export type SessionCompletionOutcome = 'completed' | 'failed';

export interface SessionCompletionToastPayload {
  agentId: string;
  jobId: string;
  sessionId: string;
  sessionTitle?: string | null;
  outcome: SessionCompletionOutcome;
}

export type MainToRender = {
  sessionCompletion: SessionCompletionToastPayload;
};

export const mainToRender = connectMainToRender<MainToRender>('notification');
