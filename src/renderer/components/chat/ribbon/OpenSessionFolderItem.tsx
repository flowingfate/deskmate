import { FileSearch } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import type { SessionActionTarget } from './useSessionActionTarget';

import { useToast } from '@/components/ui/ToastProvider';
import { chatSessionApi } from '@/ipc/chatSession';
import { workspaceApi } from '@/ipc/workspace';
import { RibbonItem } from './RibbonItem';

interface OpenSessionFolderItemProps {
  target: SessionActionTarget;
}

function getOpenFolderLabel(target: SessionActionTarget, isOpening: boolean): string {
  if (isOpening) return 'Opening session folder';

  switch (target.kind) {
    case 'regular':
      return 'Open session folder';
    case 'empty':
      return 'No session folder to open';
    case 'job-run':
      return 'Job run folders cannot be opened';
    case 'switching':
      return 'Session is still opening';
  }
}

export function OpenSessionFolderItem({ target }: OpenSessionFolderItemProps): ReactElement {
  const [isOpening, setIsOpening] = useState(false);
  const toast = useToast();
  const isDisabled = target.kind !== 'regular' || isOpening;
  const label = getOpenFolderLabel(target, isOpening);

  async function handleOpenFolder(): Promise<void> {
    if (target.kind !== 'regular' || isOpening) return;

    const { agentId, sessionId } = target;
    setIsOpening(true);
    try {
      const pathResult = await chatSessionApi.getFilePath(agentId, sessionId);
      if (!pathResult.success) {
        toast.showError(pathResult.error);
        return;
      }

      const openResult = await workspaceApi.openPath(pathResult.filePath);
      if (!openResult.success) {
        toast.showError(openResult.error || 'Unable to open session folder');
      }
    } catch {
      toast.showError('Unable to open session folder');
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <RibbonItem
      disabled={isDisabled}
      onClick={() => void handleOpenFolder()}
      aria-label={label}
      tooltip={label}
    >
      <FileSearch size={14} aria-hidden="true" />
    </RibbonItem>
  );
}
