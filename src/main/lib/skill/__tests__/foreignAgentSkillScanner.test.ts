import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scanForeignAgentSkills } from '../foreignAgentSkillScanner';

function writeSkill(dir: string, name: string, description: string, extra: string = ''): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n${extra}---\nBody\n`,
    'utf-8',
  );
}

describe('scanForeignAgentSkills', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'foreign-skill-scan-'));
    process.env.DESKMATE_FOREIGN_SKILLS_HOME = tempHome;
  });

  afterEach(() => {
    delete process.env.DESKMATE_FOREIGN_SKILLS_HOME;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('returns empty categories when registry directories are missing', async () => {
    const result = await scanForeignAgentSkills();

    expect(result.success).toBe(true);
    expect(result.categories).toHaveLength(8);
    expect(result.categories.every((category) => category.exists === false)).toBe(true);
    expect(result.categories.flatMap((category) => category.candidates)).toEqual([]);
  });

  it('scans valid SKILL.md and lowercase skill.md entries one level deep', async () => {
    writeSkill(path.join(tempHome, '.claude', 'skills', 'pdf'), 'pdf', 'PDF tools', 'version: 1.2.3\n');
    const lowercaseDir = path.join(tempHome, '.codex', 'skills', 'browser');
    fs.mkdirSync(lowercaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(lowercaseDir, 'skill.md'),
      '---\nname: browser\ndescription: Browser tools\n---\nBody\n',
      'utf-8',
    );
    writeSkill(path.join(tempHome, '.claude', 'skills', 'nested', 'ignored'), 'ignored', 'Ignored');

    const result = await scanForeignAgentSkills();
    const candidates = result.categories.flatMap((category) => category.candidates);

    expect(candidates.map((candidate) => candidate.name).sort()).toEqual(['browser', 'pdf']);
    expect(candidates.find((candidate) => candidate.name === 'pdf')).toEqual(expect.objectContaining({
      sourceId: 'claude-code',
      sourcePathDisplay: expect.stringContaining('~'),
      version: '1.2.3',
      valid: true,
    }));
  });

  it('filters internal skills and preserves duplicate names across sources', async () => {
    writeSkill(path.join(tempHome, '.claude', 'skills', 'pdf'), 'pdf', 'Claude PDF');
    writeSkill(path.join(tempHome, '.codex', 'skills', 'pdf'), 'pdf', 'Codex PDF');
    writeSkill(path.join(tempHome, '.cursor', 'skills', 'internal'), 'internal', 'Internal', 'internal: true\n');

    const result = await scanForeignAgentSkills();
    const candidates = result.categories.flatMap((category) => category.candidates);

    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.name === 'pdf')).toBe(true);
    expect(candidates.every((candidate) => candidate.duplicateSourceCount === 2)).toBe(true);
  });

  it('marks invalid names without dropping the candidate', async () => {
    writeSkill(path.join(tempHome, '.claude', 'skills', 'bad'), 'Bad Name', 'Invalid');

    const result = await scanForeignAgentSkills();
    const [candidate] = result.categories.flatMap((category) => category.candidates);

    expect(candidate).toEqual(expect.objectContaining({
      name: 'Bad Name',
      valid: false,
      invalidReason: expect.stringContaining('spaces'),
    }));
  });

  it('warns on a directory with broken SKILL.md but never leaks absolute paths', async () => {
    // 有 SKILL.md 但无 front-matter → 记 warning。断言 warning 已脱敏（home → ~），
    // 不含临时目录绝对路径（复刻真实场景里 ENOENT/parse 错误内嵌绝对路径的问题）。
    const badDir = path.join(tempHome, '.claude', 'skills', 'broken');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'SKILL.md'), 'no front matter here\n', 'utf-8');

    const result = await scanForeignAgentSkills();

    expect(result.success).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('broken'))).toBe(true);
    for (const warning of result.warnings) {
      expect(warning).not.toContain(tempHome);
    }
  });

  it('does not record a warning for absent source directories', async () => {
    // 全部来源目录都不存在 → success，且不产生任何 warning（缺失是正常态，非错误）。
    const result = await scanForeignAgentSkills();

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.categories.every((category) => category.exists === false)).toBe(true);
  });
});
