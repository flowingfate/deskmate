import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillManager } from '../skillManager';

describe('SkillManager.validateSkillPackage', () => {
  let tempRoot: string;
  let skillManager: SkillManager;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-manager-test-'));
    skillManager = SkillManager.getInstance();
  });

  afterEach(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects packages whose SKILL.md name does not match the expected skill name', () => {
    const extractedDir = path.join(tempRoot, 'pdf');
    fs.mkdirSync(extractedDir, { recursive: true });
    fs.writeFileSync(
      path.join(extractedDir, 'SKILL.md'),
      '---\nname: web-search\ndescription: test\n---\n',
      'utf-8',
    );

    const result = skillManager.validateSkillPackage(extractedDir, 'pdf');

    expect(result).toEqual({
      valid: false,
      error: 'Skill package contains skill "web-search" but expected "pdf"',
    });
  });
});