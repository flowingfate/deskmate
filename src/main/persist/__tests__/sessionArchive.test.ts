import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';


let tmpRoot = '';

async function freshModules() {
  vi.resetModules();
  const root = await import('../lib/root');
  root.setRootForTesting(tmpRoot);
  const registry = await import('../../profileRegistry');
  registry.ProfileRegistry.resetForTesting();
  const db = await import('../lib/db/db');
  db.ProfileDb.resetForTesting();
  return { ProfileRegistry: registry.ProfileRegistry };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-archive-'));
});

afterEach(async () => {
  const db = await import('../lib/db/db');
  db.ProfileDb.closeAll();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('session ZIP archive', () => {
  it('preserves raw messages, sandbox files, and subruns while assigning imported ownership', async () => {
    const fresh = await freshModules();
    await fresh.ProfileRegistry.bootstrap();
    const store = fresh.ProfileRegistry.require(fresh.ProfileRegistry.defaultProfileId).store;
    const { exportSessionArchive, importSessionArchive } = await import('../sessionArchive');
    const sourceAgent = await store.createAgent({ name: 'Source', version: '1' });
    const destinationAgent = await store.createAgent({ name: 'Destination', version: '1' });
    const source = await sourceAgent.createSession({ title: 'Archive me' });

    source.appendToolResponse('call_1', { time: 1, status: 'success', result: 'preserve this line', images: [] });
    await source.ensureFilesDir();
    fs.mkdirSync(path.join(source.filesDir(), 'nested'), { recursive: true });
    fs.writeFileSync(path.join(source.filesDir(), 'nested', 'attachment.txt'), 'attachment payload');
    fs.mkdirSync(path.join(path.dirname(source.filesDir()), 'subruns', '001'), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(source.filesDir()), 'subruns', '001', 'messages.jsonl'), '{"role":"user"}\n');

    const archivePath = path.join(tmpRoot, 'session.zip');
    const generateAsync = vi.spyOn(JSZip.prototype, 'generateAsync');
    await exportSessionArchive(source, archivePath);
    expect(generateAsync).not.toHaveBeenCalled();
    generateAsync.mockRestore();

    const zip = await JSZip.loadAsync(fs.readFileSync(archivePath));
    const info = await zip.file(`${source.id}/info.json`)?.async('string');
    expect(info).toContain('"version": 1');
    expect(zip.file(`${source.id}/files/nested/attachment.txt`)).not.toBeNull();
    expect(zip.file(`${source.id}/subruns/001/messages.jsonl`)).not.toBeNull();

    const imported = await importSessionArchive(archivePath, {
      profileId: store.id,
      agentId: destinationAgent.id,
    });
    const importedDir = path.join(
      tmpRoot,
      'profiles',
      store.id,
      'agents',
      destinationAgent.id,
      'sessions',
      source.month,
      imported.sessionId,
    );

    expect(imported.sourceSessionId).toBe(source.id);
    expect(fs.existsSync(path.join(importedDir, 'info.json'))).toBe(false);

    expect(imported.sessionId).not.toBe(source.id);
    expect(
      fs.readFileSync(path.join(importedDir, 'messages.jsonl'), 'utf8'),
    ).toBe(fs.readFileSync(path.join(path.dirname(source.filesDir()), 'messages.jsonl'), 'utf8'));
    expect(fs.readFileSync(path.join(importedDir, 'files', 'nested', 'attachment.txt'), 'utf8')).toBe('attachment payload');
    expect(
      fs.readFileSync(path.join(importedDir, 'subruns', '001', 'messages.jsonl'), 'utf8'),
    ).toBe('{"role":"user"}\n');

    const importedData = JSON.parse(fs.readFileSync(path.join(importedDir, 'data.json'), 'utf8'));
    expect(importedData.id).toBe(imported.sessionId);
    expect(importedData.agentId).toBe(destinationAgent.id);
    expect(importedData.title).toBe(source.title);
    expect(store.sessionIdx.findById(imported.sessionId)?.agentId).toBe(destinationAgent.id);
  });

  it('rejects archives with excessive entries before extraction', async () => {
    const { importSessionArchive } = await import('../sessionArchive');
    const zip = new JSZip();
    for (let index = 0; index <= 1_000; index += 1) {
      zip.file(`session/file-${index}.txt`, 'x');
    }
    const archivePath = path.join(tmpRoot, 'too-many-entries.zip');
    fs.writeFileSync(archivePath, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(importSessionArchive(archivePath, { profileId: 'p_test', agentId: 'a_test' }))
      .rejects.toThrow(/entry limit/);
  });
});
