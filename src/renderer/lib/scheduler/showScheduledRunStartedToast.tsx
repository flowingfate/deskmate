import React from 'react'

import type { SchedulerManualRunResult } from '@shared/ipc/scheduler'

import type { ToastMessage } from '../../components/ui/Toast'

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

interface ShowScheduledRunStartedToastParams {
  result?: SchedulerManualRunResult
  /** Owning agent id. Required to build the URL; omit only on legacy callers. */
  agentId?: string
  /** Owning schedule job id; required so the toast deep-links into the job-runs sub-screen. */
  jobId: string
  navigate: NavigateWithOptionsFn
  showToast: ShowToastFn
  showSuccess: ShowSuccessFn
}

/**
 * Persistent toast shown when the user manually triggers a schedule run.
 * The "Open schedule run" action navigates to
 * `/agent/:agentId/job/:jobId/:sessionId`, which lands the user inside the
 * job-runs sub-screen of `SessionPanel` with the new run highlighted.
 */
export function showScheduledRunStartedToast({
  result,
  agentId,
  jobId,
  navigate,
  showToast,
  showSuccess,
}: ShowScheduledRunStartedToastParams): void {
  if (agentId && result?.chatSessionId) {
    showToast('Scheduled run started.', 'success', undefined, {
      persistent: true,
      actions: [
        {
          label: 'Open schedule run',
          variant: 'primary',
          onClick: () => {
            navigate(`/agent/${agentId}/job/${jobId}/${result.chatSessionId}`, {
              state: {
                intent: 'open-session',
                source: 'schedule-run-toast',
                targetAgentId: agentId,
                targetSessionId: result.chatSessionId,
              },
            })
          },
        },
      ],
    })
    return
  }

  showSuccess('Scheduled run started.')
}

export default showScheduledRunStartedToast
