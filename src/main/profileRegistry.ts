import type {
  GuestProfileEntry,
  ProfileIndexEntry,
  ProfilesIndexFile,
  SignedInProfileEntry,
} from '@shared/persist/types';
import type { ProfileRemovalBlockReason, ProfileRemovalResult } from '@shared/ipc/profiles';
import { newEntityId } from '@shared/persist/id';
import { nowIso } from '@shared/persist/time';
import { PERSIST_PATH } from '@shared/persist/path';
import { readJsonOrNull, removeDirIfExists, writeJson } from '@main/persist/lib/atomic';
import { getAppRoot } from '@main/persist/lib/root';
import { ProfileStore } from '@main/persist/profileStore';
import { log } from '@main/log';
import type { SchedulerRuntimeDiagnostics } from '@main/lib/scheduler/types';

import { Profile } from './profile';

const PROFILES_FILE_VERSION = 1 as const;
const logger = log.child({ mod: 'ProfileRegistry' });

function isSignedIn(entry: ProfileIndexEntry): entry is SignedInProfileEntry {
  return entry.kind === 'signed_in';
}

function create() {
  let items: ProfileIndexEntry[] = [];
  let defaultProfileId = '';
  let indexBootstrapped = false;
  let indexBootstrapPromise: Promise<{ warnings: string[] }> | undefined;
  let mutationTail: Promise<void> = Promise.resolve();
  const removing = new Map<string, Promise<void>>();
  const profiles = new Map<string, Profile>();
  const loading = new Map<string, Promise<Profile>>();

  function indexFilePath(): string {
    return PERSIST_PATH.profilesIndex(getAppRoot());
  }

  function cloneEntry(entry: ProfileIndexEntry): ProfileIndexEntry {
    return { ...entry };
  }

  function cloneItems(source: readonly ProfileIndexEntry[]): ProfileIndexEntry[] {
    return source.map(cloneEntry);
  }

  function toFile(nextItems: readonly ProfileIndexEntry[], nextDefaultProfileId: string): ProfilesIndexFile {
    return {
      version: PROFILES_FILE_VERSION,
      activeProfileId: nextDefaultProfileId,
      items: cloneItems(nextItems),
    };
  }

  function commitIndex(nextItems: ProfileIndexEntry[], nextDefaultProfileId: string): void {
    items = nextItems;
    defaultProfileId = nextDefaultProfileId;
  }

  async function writeIndex(nextItems: ProfileIndexEntry[], nextDefaultProfileId: string): Promise<void> {
    await writeJson(indexFilePath(), toFile(nextItems, nextDefaultProfileId));
  }

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = mutationTail.then(operation, operation);
    mutationTail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  function makeGuestEntry(id: string, displayName?: string): GuestProfileEntry {
    const timestamp = nowIso();
    return {
      id,
      displayName: displayName ?? 'Guest',
      createdAt: timestamp,
      lastActiveAt: timestamp,
      kind: 'guest',
    };
  }

  async function initializeIndex(): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    const file = await readJsonOrNull<ProfilesIndexFile>(indexFilePath());
    if (!file || !Array.isArray(file.items) || file.items.length === 0) {
      const entry = makeGuestEntry(newEntityId('p'));
      const nextItems = [entry];
      await writeIndex(nextItems, entry.id);
      commitIndex(nextItems, entry.id);
    } else {
      const nextItems = cloneItems(file.items);
      const nextDefaultProfileId = nextItems.some((entry) => entry.id === file.activeProfileId)
        ? file.activeProfileId
        : nextItems[0].id;
      if (nextDefaultProfileId !== file.activeProfileId) {
        warnings.push(`activeProfileId ${file.activeProfileId} not in items; fell back to ${nextDefaultProfileId}`);
        await writeIndex(nextItems, nextDefaultProfileId);
      }
      commitIndex(nextItems, nextDefaultProfileId);
    }
    indexBootstrapped = true;
    return { warnings };
  }

  function bootstrapIndex(): Promise<{ warnings: string[] }> {
    if (indexBootstrapped) return Promise.resolve({ warnings: [] });
    if (indexBootstrapPromise) return indexBootstrapPromise;

    const pending = initializeIndex();
    indexBootstrapPromise = pending;
    const release = () => {
      if (indexBootstrapPromise === pending) indexBootstrapPromise = undefined;
    };
    void pending.then(release, release);
    return pending;
  }

  function list(): readonly ProfileIndexEntry[] {
    return cloneItems(items);
  }

  function getEntry(id: string): ProfileIndexEntry | undefined {
    const entry = items.find((item) => item.id === id);
    return entry ? cloneEntry(entry) : undefined;
  }

  async function createEntry(input: { displayName?: string } = {}): Promise<ProfileIndexEntry> {
    await bootstrapIndex();
    return enqueueMutation(async () => {
      const entry = makeGuestEntry(newEntityId('p'), input.displayName);
      const nextItems = [...items, entry];
      await writeIndex(nextItems, defaultProfileId);
      commitIndex(nextItems, defaultProfileId);
      return cloneEntry(entry);
    });
  }

  async function updateMetadata(id: string, input: { displayName: string }): Promise<ProfileIndexEntry> {
    await bootstrapIndex();
    return enqueueMutation(async () => {
      const entry = items.find((item) => item.id === id);
      if (!entry) throw new Error(`ProfileRegistry.updateMetadata: unknown profile id ${id}`);

      const updated: ProfileIndexEntry = {
        ...entry,
        displayName: input.displayName,
      };
      const nextItems = items.map((item) => item.id === id ? updated : item);
      await writeIndex(nextItems, defaultProfileId);
      commitIndex(nextItems, defaultProfileId);
      return cloneEntry(updated);
    });
  }

  async function removeEntry(id: string): Promise<void> {
    await bootstrapIndex();
    await enqueueMutation(async () => {
      if (items.length <= 1) throw new Error('ProfileRegistry.remove: cannot delete the last profile');

      const nextItems = items.filter((entry) => entry.id !== id);
      if (nextItems.length === items.length) throw new Error(`ProfileRegistry.remove: unknown profile id ${id}`);

      const nextDefaultProfileId = defaultProfileId === id ? nextItems[0].id : defaultProfileId;
      await writeIndex(nextItems, nextDefaultProfileId);
      commitIndex(nextItems, nextDefaultProfileId);
    });
  }

  function getRemovalBlockReason(id: string, currentProfileId: string): ProfileRemovalBlockReason | undefined {
    if (!getEntry(id)) throw new Error(`ProfileRegistry.remove: unknown profile id ${id}`);
    if (id === currentProfileId) return 'current';
    if (items.length <= 1) return 'last';
    if (profiles.get(id)?.getMainWindow()) return 'open';
    return undefined;
  }

  async function load(id: string): Promise<Profile> {
    const profile = new Profile(await ProfileStore.load(id));
    await profile.start();
    profiles.set(id, profile);
    return profile;
  }

  function resetForTesting(): void {
    items = [];
    defaultProfileId = '';
    indexBootstrapped = false;
    indexBootstrapPromise = undefined;
    mutationTail = Promise.resolve();
    profiles.clear();
    loading.clear();
    removing.clear();
  }

  function releaseRemoval(id: string, pending: Promise<void>): void {
    const release = () => {
      if (removing.get(id) === pending) removing.delete(id);
    };
    void pending.then(release, release);
  }

  async function getOrLoad(id: string): Promise<Profile> {
    if (removing.has(id)) {
      return Promise.reject(new Error(`ProfileRegistry.getOrLoad: profile ${id} is being removed`));
    }
    const existing = profiles.get(id);
    if (existing) return existing;

    const pending = loading.get(id);
    if (pending) return pending;

    const next = load(id);
    loading.set(id, next);
    try {
      return await next;
    } finally {
      if (loading.get(id) === next) loading.delete(id);
    }
  }

  function require(id: string): Profile {
    if (removing.has(id)) throw new Error(`ProfileRegistry.require: profile ${id} is being removed`);
    const profile = profiles.get(id);
    if (!profile) throw new Error(`ProfileRegistry.require: profile ${id} is not loaded`);
    return profile;
  }

  async function bootstrap(): Promise<{ warnings: string[] }> {
    const { warnings } = await bootstrapIndex();
    const loaded = await Promise.allSettled(list().map((entry) => getOrLoad(entry.id)));
    for (const result of loaded) {
      if (result.status === 'rejected') warnings.push(`profile load failed: ${String(result.reason)}`);
    }
    return { warnings };
  }

  function getSchedulerDiagnostics(): SchedulerRuntimeDiagnostics[] {
    return [...profiles.values()].map((profile) => profile.scheduler.getRuntimeDiagnostics());
  }

  async function handleSystemResume(suspendedAtMs: number, resumedAtMs: number): Promise<void> {
    const activeProfiles = [...profiles.values()];
    const results = await Promise.allSettled(
      activeProfiles.map((profile) => profile.scheduler.handleSystemResume(suspendedAtMs, resumedAtMs)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        logger.warn({ msg: 'Profile scheduler resume catch-up failed', profileId: activeProfiles[index].id, err: result.reason });
      }
    }
  }

  async function createProfile(input: { displayName?: string } = {}): Promise<Profile> {
    const entry = await createEntry(input);
    return getOrLoad(entry.id);
  }

  async function removeProfile(id: string): Promise<void> {
    if (!getEntry(id)) {
      throw new Error(`ProfileRegistry.remove: unknown profile id ${id}`);
    }

    const profile = profiles.get(id);
    if (profile) {
      await profile.dispose();
      profiles.delete(id);
    }
    await removeEntry(id);
    await removeDirIfExists(PERSIST_PATH.profileDir(getAppRoot(), id));
  }

  async function removeClosed(id: string, currentProfileId: string): Promise<ProfileRemovalResult> {
    const existing = removing.get(id);
    if (existing) {
      await existing;
      return { kind: 'deleted' };
    }
    const pending: Promise<ProfileRemovalResult> = Promise.resolve().then(
      async (): Promise<ProfileRemovalResult> => {
        const reason = getRemovalBlockReason(id, currentProfileId);
        if (reason) return { kind: 'blocked', reason };
        await removeProfile(id);
        return { kind: 'deleted' };
      },
    );
    const lock = pending.then(() => undefined);
    removing.set(id, lock);
    releaseRemoval(id, lock);
    return pending;
  }

  function remove(id: string): Promise<void> {
    const pending = removing.get(id);
    if (pending) return pending;

    const next = removeProfile(id);
    removing.set(id, next);
    releaseRemoval(id, next);
    return next;
  }

  async function attachAuth(id: string, provider: string, alias: string): Promise<void> {
    await bootstrapIndex();
    await enqueueMutation(async () => {
      const entry = items.find((item) => item.id === id);
      if (!entry) throw new Error(`ProfileRegistry.attachAuth: unknown profile id ${id}`);

      const next: SignedInProfileEntry = {
        id: entry.id,
        displayName: entry.displayName,
        avatar: entry.avatar,
        createdAt: entry.createdAt,
        lastActiveAt: nowIso(),
        kind: 'signed_in',
        authProvider: provider,
        authAlias: alias,
      };
      const nextItems = items.map((item) => item.id === id ? next : item);
      await writeIndex(nextItems, defaultProfileId);
      commitIndex(nextItems, defaultProfileId);
    });
  }

  async function detachAuth(id: string): Promise<void> {
    await bootstrapIndex();
    await enqueueMutation(async () => {
      const entry = items.find((item) => item.id === id);
      if (!entry) throw new Error(`ProfileRegistry.detachAuth: unknown profile id ${id}`);
      if (!isSignedIn(entry)) return;

      const next: GuestProfileEntry = {
        id: entry.id,
        displayName: entry.displayName,
        avatar: entry.avatar,
        createdAt: entry.createdAt,
        lastActiveAt: nowIso(),
        kind: 'guest',
      };
      const nextItems = items.map((item) => item.id === id ? next : item);
      await writeIndex(nextItems, defaultProfileId);
      commitIndex(nextItems, defaultProfileId);
    });
  }

  async function shutdownAll(): Promise<void> {
    await Promise.allSettled([...profiles.values()].map((profile) => profile.dispose()));
    profiles.clear();
  }

  return {
    get items(): readonly ProfileIndexEntry[] {
      return list();
    },
    get defaultProfileId(): string {
      return defaultProfileId;
    },
    resetForTesting,
    bootstrap,
    list,
    getEntry,
    getOrLoad,
    require,
    getSchedulerDiagnostics,
    handleSystemResume,
    create: createProfile,
    remove,
    updateMetadata,
    getRemovalBlockReason,
    removeClosed,
    attachAuth,
    detachAuth,
    shutdownAll,
  };
}

export const ProfileRegistry = create();
