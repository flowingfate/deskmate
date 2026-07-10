import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { extractZip } from '../skillArchive';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-archive-test-'));
  tempRoots.push(root);
  return root;
}

async function writeArchive(
  root: string,
  configure: (zip: JSZip) => void,
): Promise<string> {
  const zip = new JSZip();
  configure(zip);
  const archivePath = path.join(root, 'skill.zip');
  fs.writeFileSync(archivePath, await zip.generateAsync({ type: 'nodebuffer' }));
  return archivePath;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('extractZip', () => {
  it('extracts a valid rooted skill archive', async () => {
    const root = createTempRoot();
    const archivePath = await writeArchive(root, (zip) => {
      zip.file('pdf/SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n');
      zip.file('pdf/scripts/run.py', 'print("ok")\n');
    });
    const extractDir = path.join(root, 'extract');

    await expect(extractZip(archivePath, extractDir)).resolves.toBe('pdf');
    expect(fs.readFileSync(path.join(extractDir, 'pdf', 'scripts', 'run.py'), 'utf-8')).toBe(
      'print("ok")\n',
    );
  });
  it('rejects archive entries with Windows traversal separators', async () => {
    const root = createTempRoot();
    const archivePath = await writeArchive(root, (zip) => {
      zip.file('..\\outside.txt', 'escaped');
    });

    await expect(extractZip(archivePath, path.join(root, 'extract'))).rejects.toThrow(
      /Unsafe archive entry path/,
    );
  });

  it('rejects archives with too many entries before extraction', async () => {
    const root = createTempRoot();
    const archivePath = await writeArchive(root, (zip) => {
      for (let index = 0; index <= 1_000; index += 1) {
        zip.file(`skill/file-${index}.txt`, 'x');
      }
    });

    await expect(extractZip(archivePath, path.join(root, 'extract'))).rejects.toThrow(
      /entry limit/,
    );
  });
});
