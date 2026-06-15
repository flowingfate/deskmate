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
  'getSessionMessages',
  'getUnreadSummary',
  'updateConfirmationSettings',
]);

export default invoke;
