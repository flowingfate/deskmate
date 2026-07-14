import { atom } from '@/atom';
import { requestConfirmation } from '@/components/ui/ConfirmationDialog';
import { UpdateInfo, CheckPhase } from './UpdateDialog';
import { updateApi, updateEvents } from '@/ipc/update';
import { log } from '@/log';
import pkg from '../../../../package.json';

const logger = log.child({ mod: 'UpdateProvider' });

export type UpdateStatus = 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'no-update';

export interface UpdateProgress {
  percent: number;
  transferred: number | string;
  total: number | string;
  speed: number | string;
}

interface UpdateState {
  status: UpdateStatus;
  updateInfo?: UpdateInfo;
  progress?: UpdateProgress;
  error?: string;
  isDialogOpen: boolean;
  checkPhase: CheckPhase;
  updaterProgress?: UpdateProgress;
  downloadUrl?: string;
  downloadedFilePath?: string;
  lastNotificationTime: number;
  lastManualCheckTime: number;
  updateCheckCount: number;
  isRestarting: boolean;
}

const zeroState: UpdateState = {
  status: 'no-update',
  isDialogOpen: false,
  checkPhase: 'idle',
  lastNotificationTime: 0,
  lastManualCheckTime: 0,
  updateCheckCount: 0,
  isRestarting: false,
};

const NOTIFICATION_COOLDOWN = 24 * 60 * 60 * 1000;
const CRITICAL_UPDATE_KEYWORDS = ['security', 'critical', 'urgent', 'vulnerability', 'secure', 'emergency', 'bug'];

function shouldShowUpdateNotification(updateInfo: UpdateInfo, lastNotificationTime: number): boolean {
  const timeSinceLastNotification = Date.now() - lastNotificationTime;
  if (timeSinceLastNotification < NOTIFICATION_COOLDOWN) {
    return false;
  }

  const isCriticalUpdate = updateInfo.releaseNotes &&
    CRITICAL_UPDATE_KEYWORDS.some(keyword =>
      updateInfo.releaseNotes!.toLowerCase().includes(keyword.toLowerCase())
    );
  if (isCriticalUpdate) {
    return true;
  }

  try {
    const currentVersion = pkg.version || '1.0.0';
    const [currentMajor] = currentVersion.split('.').map(Number);
    const [updateMajor] = updateInfo.version.split('.').map(Number);
    if (updateMajor > currentMajor) {
      return true;
    }
  } catch (_) { /* ignore */ }

  if (updateInfo.releaseDate) {
    const releaseTime = new Date(updateInfo.releaseDate).getTime();
    const timeSinceRelease = Date.now() - releaseTime;
    if (timeSinceRelease < 7 * 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  return false;
}


export const updateAtom = atom(zeroState, (get, set) => {

  function patch(partial: Partial<UpdateState>) {
    set({ ...get(), ...partial });
  }

  async function checkForUpdates() {
    try {
      patch({
        lastManualCheckTime: Date.now(),
        status: 'checking',
        checkPhase: 'idle',
        updaterProgress: undefined,
        error: undefined,
        isDialogOpen: true,
      });
      const result = await updateApi.checkForUpdates();
      if (!result.success) {
        patch({ status: 'error', error: result.error || 'Check for updates failed' });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check for updates';
      patch({ status: 'error', error: errorMessage, isDialogOpen: true });
    }
  }

  async function silentCheckForUpdates() {
    try {
      await updateApi.checkForUpdates(true);
    } catch (_) { /* silent */ }
  }

  async function downloadUpdate() {
    try {
      patch({ status: 'downloading', error: undefined });
      await updateApi.downloadUpdate(get().downloadUrl);
    } catch (err) {
      patch({ status: 'error', error: err instanceof Error ? err.message : 'Download update failed' });
    }
  }

  async function installUpdate(filePathOverride?: string) {
    try {
      const state = get();
      const targetFilePath = filePathOverride || state.downloadedFilePath;

      if (typeof targetFilePath !== 'string') {
        const finalFilePath = state.downloadedFilePath;
        if (typeof finalFilePath !== 'string') {
          throw new Error('No valid file path available for installation');
        }
      }

      const finalFilePath = typeof targetFilePath === 'string' ? targetFilePath : state.downloadedFilePath;
      if (!finalFilePath) return;

      const confirmed = await requestConfirmation({
        title: 'Restart to install update?',
        description: 'Installing the new version requires closing the app. Do you want to continue with the installation?',
        confirmLabel: 'Restart now',
      });
      if (!confirmed) return;

      patch({ isDialogOpen: false, isRestarting: true });
      try {
        updateApi.quitAndInstall(finalFilePath);
      } catch (installError) {
        patch({ isRestarting: false });
        throw installError;
      }
    } catch (err) {
      patch({ isRestarting: false });
    }
  }

  async function skipVersion(version: string) {
    try {
      await updateApi.skipVersion(version);
      patch({ status: 'no-update', isDialogOpen: false });
    } catch (_) { /* ignore */ }
  }

  function dismissDialog() {
    patch({ isDialogOpen: false });
  }

  function showUpdateDialog() {
    patch({ isDialogOpen: true });
  }

  function setupListeners(): () => void {
    const removeUpdateAvailable = updateEvents.updateAvailable((_event, updateInfo: any) => {
      const newUpdateInfo: UpdateInfo = {
        version: updateInfo.latest || updateInfo.version,
        releaseNotes: updateInfo.releaseNotes,
        releaseDate: updateInfo.releaseDate,
        downloadSize: updateInfo.files?.[0]?.size,
      };

      const partial: Partial<UpdateState> = {
        status: 'available',
        updateInfo: newUpdateInfo,
      };

      if (updateInfo.downloadUrl) {
        partial.downloadUrl = updateInfo.downloadUrl;
      }

      if (shouldShowUpdateNotification(newUpdateInfo, get().lastNotificationTime)) {
        partial.isDialogOpen = true;
        partial.lastNotificationTime = Date.now();
      }

      patch(partial);
    });

    const removeUpdateNotAvailable = updateEvents.updateNotAvailable((_event, data: any) => {
      const partial: Partial<UpdateState> = { status: 'no-update', isDialogOpen: false };
      if (data?.version) {
        partial.updateInfo = {
          version: data.version,
          releaseNotes: undefined,
          releaseDate: undefined,
          downloadSize: undefined,
        };
      }
      patch(partial);
    });

    const removeDownloadProgress = updateEvents.downloadProgress((_event, progressInfo: any) => {
      patch({
        status: 'downloading',
        checkPhase: 'downloadingApp',
        progress: {
          percent: progressInfo.percent,
          transferred: progressInfo.transferred,
          total: progressInfo.total,
          speed: progressInfo.bytesPerSecond,
        },
      });
    });

    const removeUpdateDownloaded = updateEvents.updateDownloaded((_event, downloadInfo: any) => {
      const state = get();
      const partial: Partial<UpdateState> = {
        status: 'downloaded',
        progress: undefined,
      };

      if (downloadInfo?.filePath) {
        partial.downloadedFilePath = downloadInfo.filePath;
      }

      if (downloadInfo?.version || downloadInfo?.releaseNotes || downloadInfo?.releaseDate) {
        partial.updateInfo = {
          version: downloadInfo.version || downloadInfo.latest || state.updateInfo?.version || (state.updateInfo as any)?.latest || 'Unknown',
          releaseNotes: downloadInfo.releaseNotes || state.updateInfo?.releaseNotes,
          releaseDate: downloadInfo.releaseDate || state.updateInfo?.releaseDate,
          downloadSize: state.updateInfo?.downloadSize,
        };
      }

      patch(partial);
    });

    const removeUpdateError = updateEvents.updateError((_event, error: any) => {
      const errorMessage = typeof error === 'string'
        ? error
        : (error?.message || 'An error occurred during the update process');
      patch({ status: 'error', checkPhase: 'idle', error: errorMessage, isDialogOpen: true });
    });

    const removeCheckPhaseChanged = updateEvents.checkPhaseChanged((_event, data: any) => {
      logger.debug({ msg: "Check phase changed:", data: data?.phase });
      const phaseMap: Record<string, CheckPhase> = {
        checkingUpdater: 'checkingUpdater',
        downloadingUpdater: 'downloadingUpdater',
        updaterReady: 'updaterReady',
        checkingVersion: 'checkingVersion',
      };
      patch({ checkPhase: phaseMap[data?.phase] || 'idle' });
    });

    const removeUpdaterDownloadProgress = updateEvents.updaterDownloadProgress((_event, progressInfo: any) => {
      logger.debug({ msg: "Updater download progress:", data: progressInfo });
      patch({
        updaterProgress: {
          percent: progressInfo.percent,
          transferred: progressInfo.transferred,
          total: progressInfo.total,
          speed: '0 B/s',
        },
      });
    });

    const removeUpdaterDownloadFailed = updateEvents.updaterDownloadFailed((_event, data: any) => {
      logger.debug({ msg: "Updater download failed:", data: data?.error });
      patch({
        status: 'error',
        checkPhase: 'idle',
        error: data?.error || 'Failed to download updater',
        isDialogOpen: true,
      });
    });

    const startupCheckTimer = setTimeout(() => {
      const autoUpdateEnabled = localStorage.getItem('autoUpdateEnabled');
      if (autoUpdateEnabled !== 'false') {
        logger.debug({ msg: "First automatic update check after startup" });
        silentCheckForUpdates();
      }
    }, 30000);

    return () => {
      clearTimeout(startupCheckTimer);
      removeUpdateAvailable();
      removeUpdateNotAvailable();
      removeDownloadProgress();
      removeUpdateDownloaded();
      removeUpdateError();
      removeCheckPhaseChanged();
      removeUpdaterDownloadProgress();
      removeUpdaterDownloadFailed();
    };
  }

  return {
    checkForUpdates,
    silentCheckForUpdates,
    downloadUpdate,
    installUpdate,
    skipVersion,
    dismissDialog,
    showUpdateDialog,
    setupListeners,
  };
});
