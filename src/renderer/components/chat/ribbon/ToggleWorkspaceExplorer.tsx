import type { ReactElement } from 'react';
import { FolderOpen, FolderClosed } from 'lucide-react';

import { WorkspaceExplorerAtom } from '../chat-side.atom';
import { RibbonItem } from './RibbonItem';

export function ToggleWorkspaceExplorer(): ReactElement {
  const [{ visible }, actions] = WorkspaceExplorerAtom.use();
  const label = visible ? 'Hide workspace explorer' : 'Show workspace explorer';

  return (
    <RibbonItem
      isActive={visible}
      onClick={actions.effectiveToggle}
      tooltip={label}
      aria-label={label}
      aria-pressed={visible}
    >
      {visible ? (
        <FolderOpen size={14} aria-hidden="true" />
      ) : (
        <FolderClosed size={14} aria-hidden="true" />
      )}
    </RibbonItem>
  );
}
