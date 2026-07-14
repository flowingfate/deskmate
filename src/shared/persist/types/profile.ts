/** `profiles.json` —— 跨 profile 索引。 */
export interface ProfilesIndexFile {
  version: 1;
  activeProfileId: string;
  items: ProfileIndexEntry[];
}

export type ProfileKind = 'guest' | 'signed_in';

interface ProfileIndexEntryBase {
  id: string;                    // 'p_{ulid}'，与目录名一致
  displayName: string;
  avatar?: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface GuestProfileEntry extends ProfileIndexEntryBase {
  kind: 'guest';
}

export interface SignedInProfileEntry extends ProfileIndexEntryBase {
  kind: 'signed_in';
  authProvider: string;          // 'ghc' | ...
  authAlias: string;
}

export type ProfileIndexEntry = GuestProfileEntry | SignedInProfileEntry;
