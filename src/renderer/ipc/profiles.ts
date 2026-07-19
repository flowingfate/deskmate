import { renderToMain } from '@shared/ipc/profiles';

export type {
  ProfileListItem,
  ProfileManagementItem,
  ProfileRemovalEligibility,
  ProfileRemovalResult,
  ProfileWindowState,
} from '@shared/ipc/profiles';

export const profilesApi = renderToMain.bindRender(
  window.electronAPI.profiles.invoke,
);
