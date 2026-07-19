import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PERSIST_PATH } from '@shared/persist/path';
import { ProfileRegistry } from '@main/profileRegistry'
import { setRootForTesting } from '@main/persist/lib/root';
import { ProfileDb } from '@main/persist/lib/db/db';

import { installSkill, linkSkill } from '../skillInstall';

let tempRoot = '';

beforeEach(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-test-'));
  setRootForTesting(tempRoot);
  ProfileRegistry.resetForTesting();
  await ProfileRegistry.bootstrap();
});

afterEach(() => {
  vi.restoreAllMocks();
  ProfileRegistry.resetForTesting();
  ProfileDb.resetForTesting();
  setRootForTesting(null);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function seedInstalledSkill(): Promise<{ skillRoot: string }> {
  const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
  const skillRoot = path.join(PERSIST_PATH.skillsDir(tempRoot, store.id), 'pdf');
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), 'old skill');
  await store.skills.upsert({ name: 'pdf', description: 'old', version: '1.0.0' });
  return { skillRoot };
}

describe('skill installation replacement', () => {
  it('replaces an installed directory and commits its new index record', async () => {
    const { skillRoot } = await seedInstalledSkill();
    const sourceDir = path.join(tempRoot, 'tmp', 'pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'new skill');

    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    await expect(installSkill(
      store,
      { name: 'pdf', description: 'new', version: '2.0.0' },
      sourceDir,
    )).resolves.toEqual({ success: true, skillName: 'pdf' });

    expect(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf-8')).toBe('new skill');
    expect(store.skills.get('pdf')).toEqual({ name: 'pdf', description: 'new', version: '2.0.0' });
  });

  it('installs a linked directory and commits its new index record', async () => {
    const sourceDir = path.join(tempRoot, 'external-pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'external skill');

    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    await expect(linkSkill(
      store,
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

    const skillRoot = path.join(PERSIST_PATH.skillsDir(tempRoot, store.id), 'pdf');
    expect(fs.lstatSync(skillRoot).isSymbolicLink()).toBe(true);
    expect(store.skills.get('pdf')).toEqual(expect.objectContaining({ name: 'pdf', version: '2.0.0' }));
  });
  it('restores the old directory when the new install cannot persist its index', async () => {
    const { skillRoot } = await seedInstalledSkill();
    const sourceDir = path.join(tempRoot, 'tmp', 'pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'new skill');

    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    vi.spyOn(store.skills, 'upsert').mockRejectedValueOnce(new Error('disk full'));

    await expect(installSkill(
      store,
      { name: 'pdf', description: 'new', version: '2.0.0' },
      sourceDir,
    )).resolves.toEqual({ success: false, error: 'Failed to save skill configuration to profile' });

    expect(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf-8')).toBe('old skill');
    expect(store.skills.get('pdf')).toEqual({ name: 'pdf', description: 'old', version: '1.0.0' });
  });

  it('restores the old directory when the new link cannot persist its index', async () => {
    const { skillRoot } = await seedInstalledSkill();
    const sourceDir = path.join(tempRoot, 'external-pdf');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), 'external skill');

    const store = ProfileRegistry.require(ProfileRegistry.defaultProfileId).store
    vi.spyOn(store.skills, 'upsert').mockRejectedValueOnce(new Error('disk full'));

    await expect(linkSkill(
      store,
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
