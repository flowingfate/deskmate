import { describe, expect, it } from 'vitest';
import type { ProfileIndexEntry } from '../../../../shared/persist/types';
import {
  listProfileItems,
  MAX_PROFILE_DISPLAY_NAME_LENGTH,
  normalizeProfileDisplayName,
} from '../profiles';

const profiles: ProfileIndexEntry[] = [
  {
    id: 'p_current',
    displayName: 'Personal',
    createdAt: '2026-07-18T00:00:00.000Z',
    lastActiveAt: '2026-07-18T00:00:00.000Z',
    kind: 'guest',
  },
  {
    id: 'p_open',
    displayName: 'Work',
    avatar: 'https://example.test/work.png',
    createdAt: '2026-07-18T00:00:00.000Z',
    lastActiveAt: '2026-07-18T00:00:00.000Z',
    kind: 'signed_in',
    authProvider: 'github',
    authAlias: 'work-user',
  },
  {
    id: 'p_closed',
    displayName: 'Research',
    createdAt: '2026-07-18T00:00:00.000Z',
    lastActiveAt: '2026-07-18T00:00:00.000Z',
    kind: 'guest',
  },
];

describe('Profile list IPC projection', () => {
  it('marks the sender owner as current and other windows independently', () => {
    expect(listProfileItems(profiles, 'p_current', (profileId) => profileId === 'p_open')).toEqual([
      {
        id: 'p_current',
        displayName: 'Personal',
        avatar: undefined,
        kind: 'guest',
        windowState: 'current',
      },
      {
        id: 'p_open',
        displayName: 'Work',
        avatar: 'https://example.test/work.png',
        kind: 'signed_in',
        windowState: 'open',
      },
      {
        id: 'p_closed',
        displayName: 'Research',
        avatar: undefined,
        kind: 'guest',
        windowState: 'closed',
      },
    ]);
  });

  it('normalizes valid names and rejects empty or overlong names', () => {
    expect(normalizeProfileDisplayName('  Research  ')).toBe('Research');
    expect(() => normalizeProfileDisplayName('   ')).toThrow('Profile name is required.');
    expect(() => normalizeProfileDisplayName('x'.repeat(MAX_PROFILE_DISPLAY_NAME_LENGTH + 1)))
      .toThrow(`Profile name must be at most ${MAX_PROFILE_DISPLAY_NAME_LENGTH} characters.`);
  });
});
