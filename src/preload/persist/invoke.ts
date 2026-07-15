import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/persist';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'getSnapshot',
  'switchProfile',
  'listAllSessions',
  'listAllScheduleRuns',
  'getSession',
  'getSessionFilesDir',
  'createAgent',
  'patchAgentFront',
  'archiveAgent',
  'unarchiveAgent',
  'duplicateAgent',
  'setPrimaryAgent',
  'listArchivedAgents',
  'getAgentDetail',
  'renameSession',
  'setSessionStarred',
  'deleteSession',
  'deleteScheduleRun',
  'forkJobRunToSession',
  'getSessionMessages',
  'getUnreadSummary',
  'updateConfirmationSettings',
  'updateWebSearchSettings',
  'getStorageOverview',
  'revealStoragePath',
]);

export default invoke;
