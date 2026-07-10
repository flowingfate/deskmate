import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PERSIST_PATH } from '@shared/persist/path';
import { Profiles } from '@main/persist/profiles';
import { setRootForTesting } from '@main/persist/lib/root';

import { installSkill, linkSkill } from '../skillInstall';

let tempRoot = '';

beforeEach(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-test-'));
  setRootForTesting(tempRoot);
  Profiles.resetForTesting();
  await Profiles.get().bootstrap();
});

afterEach(() => {
  vi.restoreAllMocks();
  Profiles.resetForTesting();
  setRootForTesting(null);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function seedInstalledSkill(): Promise<{ skillRoot: string }> {
  const profile = await Profiles.get().active();
  const skillRoot = path.join(PERSIST_PATH.skillsDir(tempRoot, profile.id), 'pdf');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), 'old skill');
  await profile.skills.upsert({ name: 'pdf', description: 'old', version: '1.0.0' });
  return { skillRoot };
}

describe('skill installation replacement', () => {
  it('replaces an installed directory and commits its new index record', async () => {
    const { skillRoot } = await seedInstalledSkill();
    const sourceDir = path.join(tempRoot, 'tmp', 'pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'new skill');

    await expect(installSkill(
      { name: 'pdf', description: 'new', version: '2.0.0' },
      sourceDir,
    )).resolves.toEqual({ success: true, skillName: 'pdf' });

    const profile = await Profiles.get().active();
    expect(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf-8')).toBe('new skill');
    expect(profile.skills.get('pdf')).toEqual({ name: 'pdf', description: 'new', version: '2.0.0' });
  });

  it('installs a linked directory and commits its new index record', async () => {
    const sourceDir = path.join(tempRoot, 'external-pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'external skill');

    await expect(linkSkill(
      {
        name: 'pdf',
        description: 'external',
        version: '2.0.0',
        foreign: {
          kind: 'link',
          id: 'claude-code',
          label: 'Claude Code',
          originalPath: sourceDir,
          importedAt: 1,
        },
      },
      sourceDir,
    )).resolves.toEqual({ success: true, skillName: 'pdf' });

    const profile = await Profiles.get().active();
    const skillRoot = path.join(PERSIST_PATH.skillsDir(tempRoot, profile.id), 'pdf');
    expect(fs.lstatSync(skillRoot).isSymbolicLink()).toBe(true);
    expect(profile.skills.get('pdf')).toEqual(expect.objectContaining({ name: 'pdf', version: '2.0.0' }));
  });
  it('restores the old directory when the new install cannot persist its index', async () => {
    const { skillRoot } = await seedInstalledSkill();
    const sourceDir = path.join(tempRoot, 'tmp', 'pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'new skill');

    const profile = await Profiles.get().active();
    vi.spyOn(profile.skills, 'upsert').mockRejectedValueOnce(new Error('disk full'));

    await expect(installSkill(
      { name: 'pdf', description: 'new', version: '2.0.0' },
      sourceDir,
    )).resolves.toEqual({ success: false, error: 'Failed to save skill configuration to profile' });

    expect(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf-8')).toBe('old skill');
    expect(profile.skills.get('pdf')).toEqual({ name: 'pdf', description: 'old', version: '1.0.0' });
  });

  it('restores the old directory when the new link cannot persist its index', async () => {
    const { skillRoot } = await seedInstalledSkill();
    const sourceDir = path.join(tempRoot, 'external-pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'external skill');

    const profile = await Profiles.get().active();
    vi.spyOn(profile.skills, 'upsert').mockRejectedValueOnce(new Error('disk full'));

    await expect(linkSkill(
      {
        name: 'pdf',
        description: 'external',
        version: '2.0.0',
        foreign: {
          kind: 'link',
          id: 'claude-code',
          label: 'Claude Code',
          originalPath: sourceDir,
          importedAt: 1,
        },
      },
      sourceDir,
    )).resolves.toEqual({ success: false, error: 'Failed to save skill configuration to profile' });

    expect(fs.lstatSync(skillRoot).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf-8')).toBe('old skill');
  });
});
