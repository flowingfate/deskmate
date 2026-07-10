const mockGetPath = vi.fn();
const mockRemove = vi.fn();
const mockActiveSync = vi.fn();

vi.mock('../../../persist', () => ({
  Profiles: { get: () => ({ activeSync: () => mockActiveSync() }) },
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
  });

  afterEach(() => {
    setRootForTesting(null);
  });

  it('removes the skill via Skills.remove (which owns disk deletion)', async () => {
    const result = await deleteInstalledSkill('pptx');

    expect(result.success).toBe(true);
    expect(result.skillName).toBe('pptx');
    // 删盘（含 linked skill 的 symlink）委托给 Skills.remove，本函数不重复删文件。
    expect(mockRemove).toHaveBeenCalledWith('pptx');
  });

  it('trims the skill name before removing', async () => {
    const result = await deleteInstalledSkill('  pptx  ');

    expect(result.success).toBe(true);
    expect(mockRemove).toHaveBeenCalledWith('pptx');
  });

  it('fails with DELETE_PROFILE_FAILED when Skills.remove throws', async () => {
    mockRemove.mockRejectedValueOnce(new Error('boom'));

    const result = await deleteInstalledSkill('pptx');

    expect(result.success).toBe(false);
    expect(result.error).toBe('DELETE_PROFILE_FAILED');
  });

  it('fails with DELETE_FILES_FAILED when no active profile', async () => {
    mockActiveSync.mockImplementationOnce(() => {
      throw new Error('no profile');
    });

    const result = await deleteInstalledSkill('pptx');

    expect(result.success).toBe(false);
    expect(result.error).toBe('DELETE_FILES_FAILED');
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
