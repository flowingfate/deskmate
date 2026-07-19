import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { updateSkillFromDevice } from '../skillDeviceImporter';
import { parseSkillMarkdown } from '../skillMetadata';
import { determineVersion, parseSkillFileName } from '../skillVersion';
import { extractZip } from '../skillArchive';
import {
  validateSkillPackage,
  createTempDirectory,
  cleanupTempDirectory,
  checkSkillExists,
  installSkill,
} from '../skillInstall';

vi.mock('../skillMetadata', async () => ({
  parseSkillMarkdown: vi.fn(),
}));
vi.mock('../skillVersion', async () => ({
  determineVersion: vi.fn(),
  parseSkillFileName: vi.fn(),
}));
vi.mock('../skillArchive', async () => ({
  extractZip: vi.fn(),
}));
vi.mock('../skillInstall', async () => ({
  validateSkillPackage: vi.fn(),
  createTempDirectory: vi.fn(),
  cleanupTempDirectory: vi.fn(),
  checkSkillExists: vi.fn(),
  installSkill: vi.fn(),
}));

describe('skillDeviceImporter.updateSkillFromDevice', () => {
  let tempRoot: string;
  const store = { id: 'p_test' };

  beforeEach(() => {
    vi.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-device-importer-test-'));

    (createTempDirectory as Mock).mockImplementation((prefix: string) => (
      fs.mkdtempSync(path.join(tempRoot, `${prefix}-`))
    ));
    (parseSkillMarkdown as Mock).mockImplementation((content: string) => {
      const versionMatch = content.match(/version:\s*"?([^\n"]+)"?/);

      return {
        metadata: {
          name: 'pdf',
          description: 'PDF skill',
          version: versionMatch?.[1] ?? '2.0.0',
        },
      };
    });
    (validateSkillPackage as Mock).mockReturnValue({ valid: true });
    (checkSkillExists as Mock).mockReturnValue({ name: 'pdf', version: '1.5.0' });
    (determineVersion as Mock).mockImplementation((metadataVersion?: string) => metadataVersion ?? '2.0.0');
    (installSkill as Mock).mockResolvedValue({ success: true });
    (cleanupTempDirectory as Mock).mockImplementation((dirPath: string) => {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  function createSkillFolder(version: string): { skillDir: string; skillMdPath: string } {
    const skillDir = path.join(tempRoot, `pdf-${version}`);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      skillMdPath,
      `---\nname: pdf\ndescription: PDF skill\nversion: ${version}\n---\n`,
      'utf-8',
    );
    fs.writeFileSync(path.join(skillDir, 'README.md'), '# test', 'utf-8');

    return { skillDir, skillMdPath };
  }

  it('updates a skill from a folder path', async () => {
    const { skillDir } = createSkillFolder('2.3.0');

    const result = await updateSkillFromDevice(store, skillDir);

    expect(result).toEqual({
      success: true,
      skillName: 'pdf',
      skillVersion: '2.3.0',
      inputType: 'folder',
    });
    expect(installSkill).toHaveBeenCalledWith(
      store,
      expect.objectContaining({
        name: 'pdf',
        description: 'PDF skill',
        version: '2.3.0',
      }),
      expect.any(String),
    );
    const installPath = (installSkill as Mock).mock.calls[0][2] as string;
    expect(path.basename(installPath)).toBe('pdf');
  });

  it('rejects when no installed skill matches the package name', async () => {
    (checkSkillExists as Mock).mockReturnValue(null);
    const { skillDir } = createSkillFolder('2.3.0');

    const result = await updateSkillFromDevice(store, skillDir);

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('No installed skill named "pdf" was found'),
    });
    expect(installSkill).not.toHaveBeenCalled();
  });

  it('rejects a direct SKILL.md path', async () => {
    const { skillMdPath } = createSkillFolder('2.4.0');

    const result = await updateSkillFromDevice(store, skillMdPath);

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('Unsupported skill input'),
    });
    expect(installSkill).not.toHaveBeenCalled();
  });
});
