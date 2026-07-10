import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { RipgrepSearchEngine } from '../RipgrepSearchEngine';

let root: string;
let external: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'deskmate-ripgrep-root-'));
  external = await mkdtemp(path.join(tmpdir(), 'deskmate-ripgrep-external-'));

  await mkdir(path.join(root, 'read-code', 'src'), { recursive: true });
  await writeFile(path.join(root, 'read-code', 'src', 'index.ts'), 'export {}');
  await mkdir(path.join(external, 'read-code'), { recursive: true });
  await writeFile(path.join(external, 'read-code', 'external.ts'), 'export {}');
  await symlink(external, path.join(root, 'linked-external'));
});

afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(external, { recursive: true, force: true }),
  ]);
});

describe('RipgrepSearchEngine', () => {
  it('returns matching directories from streamed file paths without following symlinks', async () => {
    const engine = new RipgrepSearchEngine();
    const result = await engine.search({
      folder: root,
      pattern: 'read-code',
      searchTarget: 'folders',
      maxResults: 10,
    });

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'read-code', isDirectory: true }),
    ]));
    expect(result.results).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'linked-external/read-code' }),
    ]));
  });

  it('does not spawn a search when the caller has already cancelled', async () => {
    const engine = new RipgrepSearchEngine();
    const aborter = new AbortController();
    aborter.abort();

    await expect(engine.search({
      folder: root,
      pattern: 'read-code',
      searchTarget: 'folders',
      signal: aborter.signal,
    })).rejects.toThrow('Search aborted');
  });
});
