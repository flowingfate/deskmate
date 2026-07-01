import React from 'react'

import type { SchedulerManualRunResult } from '@shared/ipc/scheduler'
import { log } from '@/log';
import type { ToastMessage } from '../../components/ui/Toast'
import { schedulerApi } from '@renderer/ipc/scheduler';

type NavigateFn = (to: string) => void

export interface ShowScheduledRunStartedToastNavigateOptions {
  state?: {
    intent?: 'open-session'
    source?: string
    targetAgentId?: string
    targetSessionId?: string
  }
}

type NavigateWithOptionsFn = (to: string, options?: ShowScheduledRunStartedToastNavigateOptions) => void

type ShowToastFn = (
  message: string | React.ReactNode,
  type?: ToastMessage['type'],
  duration?: number,
  options?: Partial<Pick<ToastMessage, 'persistent' | 'actions' | 'onDismiss'>>,
) => string

type ShowSuccessFn = (message: string | React.ReactNode, duration?: number) => void

export async function runScheduleNow(
  agentId: string,
  jobId: string,
  navigate: NavigateWithOptionsFn,
  showToast: ShowToastFn,
  showSuccess: ShowSuccessFn,
  showError: ShowSuccessFn,
) {
  try {
    const res = await schedulerApi.runJobNow(jobId);
    if (res.success && res.data) {
      const { chatSessionId } = res.data;
      if (chatSessionId) {
        showToast('Scheduled run started.', 'success', undefined, {
          persistent: true,
          actions: [
            {
              label: 'Open schedule run',
              variant: 'primary',
              onClick: () => {
                navigate(`/agent/${agentId}/job/${jobId}/${chatSessionId}`, {
                  state: {
                    intent: 'open-session',
                    source: 'schedule-run-toast',
                    targetAgentId: agentId,
                    targetSessionId: chatSessionId,
                  },
                })
              },
            },
          ],
        });
        return;
      }
      showSuccess('Scheduled run started.')
      return;
    }
    showError('Failed to run schedule: ' + (res?.error || 'Unknown error'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showError('Failed to run schedule: ' + msg);
    log.error({ msg: 'runJobNow failed', jobId: jobId, err });
  }
}
