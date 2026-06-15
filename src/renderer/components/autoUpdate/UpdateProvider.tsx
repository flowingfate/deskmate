import { useEffect, useRef } from 'react';
import { updateAtom } from './update.atom';
import { UpdateDialog } from './UpdateDialog';
import { RestartingOverlay } from './RestartingOverlay';

export type { UpdateStatus, UpdateProgress } from './update.atom';

export function useUpdate() {
  const [state, actions] = updateAtom.use();
  const { downloadUrl, downloadedFilePath, lastNotificationTime, lastManualCheckTime, updateCheckCount, ...publicState } = state;
  const { setupListeners, ...publicActions } = actions;
  return { ...publicState, ...publicActions };
}

export const UpdateHost: React.FC = () => {
  const [state, actions] = updateAtom.use();
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const cleanup = actions.setupListeners();
    return () => {
      cleanup();
      isInitializedRef.current = false;
    };
  }, []);

  return (
    <>
      <UpdateDialog
        isOpen={state.isDialogOpen}
        onClose={actions.dismissDialog}
        updateInfo={state.updateInfo}
        status={state.status}
        progress={state.progress}
        error={state.error}
        checkPhase={state.checkPhase}
        updaterProgress={state.updaterProgress}
        onCheckForUpdates={actions.checkForUpdates}
        onDownloadUpdate={actions.downloadUpdate}
        onInstallUpdate={actions.installUpdate}
        onSkipVersion={actions.skipVersion}
        onDismiss={actions.dismissDialog}
      />
      <RestartingOverlay isVisible={state.isRestarting} />
    </>
  );
};
