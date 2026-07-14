import { GitFork } from 'lucide-react';
import type { ReactElement } from 'react';

import { chatSessionCommands } from '@/states/chatSessionCommands';
import { RibbonItem } from './RibbonItem';
import type { SessionActionTarget } from './useSessionActionTarget';

interface ForkSessionItemProps {
  target: SessionActionTarget;
}

function getForkLabel(target: SessionActionTarget): string {
  switch (target.kind) {
    case 'regular':
      return 'Fork session';
    case 'empty':
      return 'No session to fork';
    case 'job-run':
      return 'Job runs cannot be forked';
    case 'switching':
      return 'Session is still opening';
  }
}

export function ForkSessionItem({ target }: ForkSessionItemProps): ReactElement {
  const runChatSessionCommand = chatSessionCommands.use();
  const isDisabled = target.kind !== 'regular';
  const label = getForkLabel(target);

  function handleFork(): void {
    if (target.kind !== 'regular') return;

    void runChatSessionCommand({ type: 'fork', sessionId: target.sessionId });
  }

  return (
    <RibbonItem
      disabled={isDisabled}
      onClick={handleFork}
      aria-label={label}
      tooltip={label}
    >
      <GitFork size={14} aria-hidden="true" />
    </RibbonItem>
  );
}
