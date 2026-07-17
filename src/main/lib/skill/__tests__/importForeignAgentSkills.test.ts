import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { importForeignAgentSkills } from '../importForeignAgentSkills';
import { addSkillFromDevice } from '../skillDeviceImporter';
import { linkSkill } from '../skillInstall';

vi.mock('../skillDeviceImporter', () => ({
  addSkillFromDevice: vi.fn(),
}));

vi.mock('../skillInstall', () => ({
  linkSkill: vi.fn(),
}));


interface MockSkillStore {
  get: Mock;
  upsert: Mock;
}

function writeSkill(dir: string, name: string, description: string, version: string = '1.0.0'): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\n---\nBody\n`,
    'utf-8',
  );
}

describe('importForeignAgentSkills', () => {
  let tempHome: string;
  let skills: MockSkillStore;

  beforeEach(() => {
    vi.clearAllMocks();
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'foreign-skill-import-'));
    process.env.DESKMATE_FOREIGN_SKILLS_HOME = tempHome;
    skills = {
      get: vi.fn().mockReturnValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    (linkSkill as Mock).mockResolvedValue({ success: true, skillName: 'pdf' });
    (addSkillFromDevice as Mock).mockResolvedValue({ success: true, skillName: 'pdf', skillVersion: '1.0.0' });
  });

  afterEach(() => {
    delete process.env.DESKMATE_FOREIGN_SKILLS_HOME;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('links a selected foreign skill and records provenance', async () => {
    const sourcePath = path.join(tempHome, '.claude', 'skills', 'pdf');
    writeSkill(sourcePath, 'pdf', 'PDF tools', '2.0.0');

    const result = await importForeignAgentSkills({ id: 'p_test', skills }, [
      {
        candidateId: 'claude-code:pdf',
        sourceId: 'claude-code',
        sourcePath,
        installMode: 'link',
        overwrite: false,
        selectedSkillName: 'pdf',
      },
    ]);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      importedCount: 1,
      linkedCount: 1,
      failedCount: 0,
    }));
    expect(linkSkill).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p_test', skills }),
      expect.objectContaining({
        name: 'pdf',
        version: '2.0.0',
        foreign: expect.objectContaining({ kind: 'link', id: 'claude-code', originalPath: sourcePath }),
      }),
      sourcePath,
    );
  });

  it('copies a selected foreign skill and preserves provenance after copy import', async () => {
    const sourcePath = path.join(tempHome, '.codex', 'skills', 'pdf');
    writeSkill(sourcePath, 'pdf', 'PDF tools');

    const result = await importForeignAgentSkills({ id: 'p_test', skills }, [
      {
        candidateId: 'codex:pdf',
        sourceId: 'codex',
        sourcePath,
        installMode: 'copy',
        overwrite: false,
        selectedSkillName: 'pdf',
      },
    ]);

    expect(result).toEqual(expect.objectContaining({ success: true, copiedCount: 1 }));
    expect(addSkillFromDevice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p_test', skills }),
      sourcePath,
      expect.any(Function),
    );
    expect(skills.upsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'pdf',
      foreign: expect.objectContaining({ kind: 'copy', originalPath: sourcePath }),
    }));
  });

  it('still reports success when copy succeeds but provenance upsert fails', async () => {
    // addSkillFromDevice 已装好 skill；仅补 provenance 的 upsert 抛错不应误报 failed
    // （skill 已可用，误报会让用户重试并撞 checkSkillExists 卡死）。
    const sourcePath = path.join(tempHome, '.claude', 'skills', 'pdf');
    writeSkill(sourcePath, 'pdf', 'PDF tools');
    skills.upsert.mockRejectedValueOnce(new Error('disk full'));

    const result = await importForeignAgentSkills({ id: 'p_test', skills }, [
      {
        candidateId: 'claude-code:pdf',
        sourceId: 'claude-code',
        sourcePath,
        installMode: 'copy',
        overwrite: false,
        selectedSkillName: 'pdf',
      },
    ]);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      copiedCount: 1,
      failedCount: 0,
    }));
    expect(result.results[0]).toEqual(expect.objectContaining({ success: true }));
  });

  it('rejects the whole batch when selected items resolve to the same name', async () => {
    const claudePath = path.join(tempHome, '.claude', 'skills', 'pdf');
    const codexPath = path.join(tempHome, '.codex', 'skills', 'pdf');
    writeSkill(claudePath, 'pdf', 'Claude PDF');
    writeSkill(codexPath, 'pdf', 'Codex PDF');

    const result = await importForeignAgentSkills({ id: 'p_test', skills }, [
      { candidateId: 'a', sourceId: 'claude-code', sourcePath: claudePath, installMode: 'link', overwrite: false, selectedSkillName: 'pdf' },
      { candidateId: 'b', sourceId: 'codex', sourcePath: codexPath, installMode: 'link', overwrite: false, selectedSkillName: 'pdf' },
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toContain('duplicate_selected_name');
    expect(linkSkill).not.toHaveBeenCalled();
    expect(addSkillFromDevice).not.toHaveBeenCalled();
  });

  it('rejects overwriting an installed skill unless overwrite is true', async () => {
    const sourcePath = path.join(tempHome, '.claude', 'skills', 'pdf');
    writeSkill(sourcePath, 'pdf', 'PDF tools');
    skills.get.mockReturnValue({ name: 'pdf', description: 'Old', version: '0.1.0' });

    const result = await importForeignAgentSkills({ id: 'p_test', skills }, [
      {
        candidateId: 'claude-code:pdf',
        sourceId: 'claude-code',
        sourcePath,
        installMode: 'link',
        overwrite: false,
        selectedSkillName: 'pdf',
      },
    ]);

    expect(result.success).toBe(false);
    expect(result.results[0]).toEqual(expect.objectContaining({
      success: false,
      isOverwrite: true,
      error: expect.stringContaining('already installed'),
    }));
    expect(linkSkill).not.toHaveBeenCalled();
  });
});
