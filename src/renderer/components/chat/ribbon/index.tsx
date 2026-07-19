import { memo, type ReactElement } from 'react';
import { TooltipProvider } from '@/shadcn/tooltip';

import { useSessionError } from '../useSessionCache';
import { ErrorBar } from './ErrorBar';
import { DevInfoBadge } from './DevInfoBadge';
import { ForkSessionItem } from './ForkSessionItem';
import { JumpToLatestItem } from './JumpToLatest';
import { OpenSessionFolderItem } from './OpenSessionFolderItem';
import { ToggleWorkspaceExplorer } from './ToggleWorkspaceExplorer';
import { RibbonTip } from './RibbonTip';
import { useSessionActionTarget } from './useSessionActionTarget';

interface ChatRibbonProps {
  agentId: string;
  jobId: string | null;
  sessionId: string | null;
  kind: 'regular' | 'job';
}

function ChatRibbon({ agentId, jobId, sessionId, kind }: ChatRibbonProps): ReactElement {
  const errorMessage = useSessionError(sessionId);
  const sessionActionTarget = useSessionActionTarget({ agentId, jobId, sessionId, kind });

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-6 shrink-0 items-stretch bg-black/2 px-3.5">
        <div className="min-w-0 flex-1">
          {errorMessage && sessionId ? (
            <ErrorBar errorMessage={errorMessage} sessionId={sessionId} />
          ) : (
            <RibbonTip />
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-stretch gap-1">
          <JumpToLatestItem />
          <ForkSessionItem target={sessionActionTarget} />
          <OpenSessionFolderItem target={sessionActionTarget} />
          {process.env.NODE_ENV === 'development' && (
            <DevInfoBadge agentId={agentId} jobId={jobId} sessionId={sessionId} />
          )}
          <ToggleWorkspaceExplorer />
        </div>
      </div>
    </TooltipProvider>
  );
}

export default memo(ChatRibbon);
