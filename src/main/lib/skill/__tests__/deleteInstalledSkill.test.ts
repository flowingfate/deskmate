const mockExistsSync = vi.fn();
const mockRmSync = vi.fn();
const mockLstatSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockGetPath = vi.fn();
const mockRemove = vi.fn();
const mockActiveSync = vi.fn();

vi.mock('../../../persist', () => ({
  Profiles: { get: () => ({ activeSync: () => mockActiveSync() }) },
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  isBuiltinSkill: (skillName: string) => skillName === 'skill-creator',
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: 1,
  BUILTIN_SKILL_CHANGELOG: { 1: ['skill-creator'] },
}));

vi.mock('fs', async () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  lstatSync: (...args: unknown[]) => mockLstatSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}));

vi.mock('electron', async () => ({
  app: {
    getPath: (...args: unknown[]) => mockGetPath(...args),
  },
}));

import { deleteInstalledSkill } from '../deleteInstalledSkill';
import { setRootForTesting } from '@main/persist/lib/root';

describe('deleteInstalledSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRootForTesting('/tmp/user-data');
    mockGetPath.mockReturnValue('/tmp/user-data');
    mockActiveSync.mockReturnValue({
      id: 'p_test',
      skills: { remove: (n: string) => mockRemove(n) },
    });
    mockRemove.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockRmSync.mockImplementation(() => undefined);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });
  });

  afterEach(() => {
    setRootForTesting(null);
  });

  it('deletes from profile and removes the skill directory when present', async () => {
    const result = await deleteInstalledSkill('pptx');

    expect(result.success).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith('pptx');
    expect(mockLstatSync).toHaveBeenCalled();
    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining(['profiles', 'p_test', 'skills', 'pptx'].join(require('path').sep)),
      { recursive: true, force: true },
    );
  });

  it('does not allow builtin skills to be deleted', async () => {
    const result = await deleteInstalledSkill('skill-creator');

    expect(result.success).toBe(false);
    expect(result.error).toBe('BUILTIN_SKILL');
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('stops when profile deletion fails', async () => {
    mockRemove.mockRejectedValueOnce(new Error('boom'));

    const result = await deleteInstalledSkill('pptx');

    expect(result.success).toBe(false);
    expect(result.error).toBe('DELETE_PROFILE_FAILED');
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('returns success even when the skill directory is already missing', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await deleteInstalledSkill('pptx');

    expect(result.success).toBe(true);
    expect(result.removedFromDisk).toBe(false);
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});
