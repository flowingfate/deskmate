import type { ReactElement } from 'react';
import { TooltipProvider } from '@/shadcn/tooltip';

import { CurrentSessionError, CurrentSessionStatus } from '@/lib/chat/agentSessionCacheManager';
import { ErrorBar } from './ErrorBar';
import { DevInfoBadge } from './DevInfoBadge';
import { ForkSessionItem } from './ForkSessionItem';
import { JumpToLatestItem } from './JumpToLatest';
import { OpenSessionFolderItem } from './OpenSessionFolderItem';
import { ToggleWorkspaceExplorer } from './ToggleWorkspaceExplorer';
import { RibbonTip } from './RibbonTip';
import { useSessionActionTarget } from './useSessionActionTarget';

export default function ChatRibbon(): ReactElement {
  const { agentId, chatSessionId } = CurrentSessionStatus.use();
  const sessionActionTarget = useSessionActionTarget();
  const errorMessage = CurrentSessionError.use();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-6 shrink-0 items-stretch bg-black/2 px-3.5">
        <div className="min-w-0 flex-1">
          {errorMessage && chatSessionId ? (
            <ErrorBar errorMessage={errorMessage} chatSessionId={chatSessionId} />
          ) : (
            <RibbonTip />
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-stretch gap-1">
          <JumpToLatestItem />
          <ForkSessionItem target={sessionActionTarget} />
          <OpenSessionFolderItem target={sessionActionTarget} />
          {process.env.NODE_ENV === 'development' && (
            <DevInfoBadge agentId={agentId} sessionId={chatSessionId} />
          )}
          <ToggleWorkspaceExplorer />
        </div>
      </div>
    </TooltipProvider>
  );
}

