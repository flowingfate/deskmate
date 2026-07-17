import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubagentRunLookupFailure } from '@shared/ipc/subagentRun';
import type { Message, SubrunId } from '@shared/persist/types';
import { subagentRunApi } from '@/ipc/subagentRun';

export type RunMessagesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; messages: Message[] }
  | { kind: 'error'; message: string };

interface UseRunMessagesOptions {
  parentAgentId: string;
  parentSessionId: string;
  subrunId: SubrunId;
}

function getFailureMessage(result: SubagentRunLookupFailure): string {
  switch (result.kind) {
    case 'parent_not_found':
    case 'error':
      return result.error;
    case 'invalid_id':
      return 'The delegated run ID is invalid.';
    case 'missing':
      return 'The delegated run transcript is unavailable.';
    case 'incomplete':
      return 'The delegated run reservation is incomplete.';
    case 'corrupt':
      return 'The delegated run record is corrupt.';
  }
}

export function useRunMessages({
  parentAgentId,
  parentSessionId,
  subrunId,
}: UseRunMessagesOptions) {
  const [state, setState] = useState<RunMessagesState>({ kind: 'idle' });
  const [requestVersion, setRequestVersion] = useState(0);
  const requestId = useRef(0);

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setState({ kind: 'loading' });

    async function loadMessages(): Promise<void> {
      try {
        const result = await subagentRunApi.getRunMessages({
          parentAgentId,
          parentSessionId,
          subrunId,
        });
        if (requestId.current !== currentRequestId) return;

        if (result.kind === 'found') {
          setState({ kind: 'ready', messages: result.messages });
          return;
        }
        setState({ kind: 'error', message: getFailureMessage(result) });
      } catch (error) {
        if (requestId.current !== currentRequestId) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void loadMessages();

    return () => {
      if (requestId.current === currentRequestId) {
        requestId.current += 1;
      }
    };
  }, [parentAgentId, parentSessionId, requestVersion, subrunId]);

  return { state, retry };
}
