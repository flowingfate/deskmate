/**
 * Session Completion Toast Hook
 *
 * 订阅 `notification` 通道的 sessionCompletion 事件，在主窗口前台可见时把
 * schedule job 完成提示渲染为 in-app toast（macOS 会静默丢弃前台 App 自发的
 * 系统通知，故主进程在前台聚焦时改走此 IPC 路线）。toast 带跳转到对应 session
 * 的 "View" 动作，与系统通知点击行为一致。
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../components/ui/ToastProvider';
import { notificationEvents } from '@/ipc/notification';

export const useSessionCompletionToast = (): null => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    const cleanup = notificationEvents.sessionCompletion((_event, data) => {
      if (!data) return;
      const { agentId, jobId, sessionId, sessionTitle, outcome } = data;
      const name = sessionTitle?.trim() || sessionId;
      const message = outcome === 'failed' ? `#${name}# failed` : `#${name}# is complete`;
      showToast(message, outcome === 'failed' ? 'error' : 'success', undefined, {
        persistent: true,
        actions: [
          {
            label: 'View',
            onClick: () => {
              navigate(`/agent/${agentId}/job/${jobId}/${sessionId}`, {
                state: {
                  intent: 'open-session',
                  source: 'session-completion-toast',
                  targetAgentId: agentId,
                  targetSessionId: sessionId,
                },
              });
            },
          },
        ],
      });
    });
    return cleanup;
  }, [navigate, showToast]);

  return null;
};

export default useSessionCompletionToast;
