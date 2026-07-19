import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/profiles';
import type {
  ProfileListItem,
  ProfileManagementItem,
  ProfileRemovalEligibility,
  ProfileWindowState,
} from '@shared/ipc/profiles';
import type { ProfileIndexEntry } from '@shared/persist/types';
import { ProfileRegistry } from '@main/profileRegistry';
import { createMainWindow } from '../main-win';
import { requireProfileForSender } from './profileContext';

export const MAX_PROFILE_DISPLAY_NAME_LENGTH = 80;

export function normalizeProfileDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) throw new Error('Profile name is required.');
  if (normalized.length > MAX_PROFILE_DISPLAY_NAME_LENGTH) {
    throw new Error(`Profile name must be at most ${MAX_PROFILE_DISPLAY_NAME_LENGTH} characters.`);
  }
  return normalized;
}

function getWindowState(
  profileId: string,
  currentProfileId: string,
  isProfileWindowOpen: (profileId: string) => boolean,
): ProfileWindowState {
  if (profileId === currentProfileId) return 'current';
  return isProfileWindowOpen(profileId) ? 'open' : 'closed';
}

export function listProfileItems(
  entries: readonly ProfileIndexEntry[],
  currentProfileId: string,
  isProfileWindowOpen: (profileId: string) => boolean,
): ProfileListItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    avatar: entry.avatar,
    kind: entry.kind,
    windowState: getWindowState(entry.id, currentProfileId, isProfileWindowOpen),
  }));
}

function isProfileWindowOpen(profileId: string): boolean {
  return ProfileRegistry.require(profileId).getMainWindow() !== null;
}

function getRemovalEligibility(profileId: string, currentProfileId: string): ProfileRemovalEligibility {
  const reason = ProfileRegistry.getRemovalBlockReason(profileId, currentProfileId);
  return reason ? { kind: 'blocked', reason } : { kind: 'allowed' };
}

function toManagementItem(entry: ProfileIndexEntry, currentProfileId: string): ProfileManagementItem {
  const [item] = listProfileItems([entry], currentProfileId, isProfileWindowOpen);
  if (!item) throw new Error(`Profile ${entry.id} is missing from the management list.`);
  return {
    ...item,
    createdAt: entry.createdAt,
    removal: getRemovalEligibility(entry.id, currentProfileId),
  };
}

function listForProfile(currentProfileId: string) {
  return listProfileItems(
    ProfileRegistry.items,
    currentProfileId,
    isProfileWindowOpen,
  );
}

function listManagedForProfile(currentProfileId: string): ProfileManagementItem[] {
  return ProfileRegistry.items.map((entry) => toManagementItem(entry, currentProfileId));
}

export default function registerProfilesIpc(): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.list((event) => listForProfile(requireProfileForSender(event).id));

  handle.listManaged((event) => listManagedForProfile(requireProfileForSender(event).id));

  handle.updateMetadata(async (event, input) => {
    const currentProfileId = requireProfileForSender(event).id;
    const entry = await ProfileRegistry.updateMetadata(input.profileId, {
      displayName: normalizeProfileDisplayName(input.displayName),
    });
    return toManagementItem(entry, currentProfileId);
  });

  handle.delete(async (event, input) => {
    const currentProfileId = requireProfileForSender(event).id;
    const entry = ProfileRegistry.getEntry(input.profileId);
    if (!entry) throw new Error(`Profile ${input.profileId} does not exist.`);
    const reason = ProfileRegistry.getRemovalBlockReason(input.profileId, currentProfileId);
    if (reason) return { kind: 'blocked', reason };
    if (entry.displayName !== input.confirmationName) {
      throw new Error('Profile name confirmation does not match.');
    }
    return ProfileRegistry.removeClosed(input.profileId, currentProfileId);
  });

  handle.createAndOpen(async (event, input) => {
    const currentProfileId = requireProfileForSender(event).id;
    const profile = await ProfileRegistry.create({
      displayName: normalizeProfileDisplayName(input.displayName),
    });

    try {
      await createMainWindow(profile.id);
    } catch {
      try {
        await ProfileRegistry.remove(profile.id);
      } catch {}
      throw new Error('Failed to open the new profile window.');
    }

    const entry = ProfileRegistry.getEntry(profile.id);
    if (!entry) throw new Error('Created profile is missing from the profile index.');
    const [createdItem] = listProfileItems(
      [entry],
      currentProfileId,
      (profileId) => ProfileRegistry.require(profileId).getMainWindow() !== null,
    );
    if (!createdItem) throw new Error('Created profile is missing from the profile index.');
    return createdItem;
  });
}
