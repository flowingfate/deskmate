import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listDirs } from '../lib/atomic';

/**
 * listDirs 的 symlink 跟随行为（linked skill 依赖它：外部 agent 目录以 symlink
 * 落在 skills/ 下，reconcile 必须能认出来，否则会把 linked skill 从索引里剔除）。
 */
describe('listDirs followSymlinks', () => {
  let tempDir: string;
  let external: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'listdirs-'));
    external = fs.mkdtempSync(path.join(os.tmpdir(), 'listdirs-ext-'));
    fs.mkdirSync(path.join(tempDir, 'real-dir'));
    fs.writeFileSync(path.join(tempDir, 'a-file'), 'x');
    fs.symlinkSync(external, path.join(tempDir, 'linked-dir'), 'dir');
    fs.symlinkSync(path.join(tempDir, 'a-file'), path.join(tempDir, 'linked-file'), 'file');
    fs.symlinkSync(path.join(tempDir, 'nope'), path.join(tempDir, 'broken-link'), 'dir');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  });

  it('excludes symlinks by default', async () => {
    expect((await listDirs(tempDir)).sort()).toEqual(['real-dir']);
  });

  it('includes dir-targeting symlinks but skips file/broken links when following', async () => {
    expect((await listDirs(tempDir, true)).sort()).toEqual(['linked-dir', 'real-dir']);
  });

  it('returns [] for a missing directory', async () => {
    expect(await listDirs(path.join(tempDir, 'ghost'), true)).toEqual([]);
  });
});
