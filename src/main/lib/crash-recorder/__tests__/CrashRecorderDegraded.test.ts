import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const electronHarness = vi.hoisted(() => ({
  on: vi.fn(),
  setPath: vi.fn(),
  start: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getName: vi.fn(() => 'Crash Recorder Test'),
    on: electronHarness.on,
    setPath: electronHarness.setPath,
  },
  crashReporter: {
    start: electronHarness.start,
  },
  BrowserWindow: class {
    public static getAllWindows(): object[] {
      return [];
    }
  },
}));

import { CrashRecorder } from '../CrashRecorder';
import { setRootForTesting } from '../../../persist/lib/root';

describe('CrashRecorder degraded startup', () => {
  let root = '';

  afterEach(() => {
    setRootForTesting('/tmp/deskmate-test-root');
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not block application startup when crash-recorder.db is corrupt', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-recorder-corrupt-'));
    const diagnostics = path.join(root, 'diagnostics', 'prod');
    fs.mkdirSync(diagnostics, { recursive: true });
    fs.writeFileSync(path.join(diagnostics, 'crash-recorder.db'), 'not a sqlite database');
    setRootForTesting(root);

    const recorder = new CrashRecorder();
    expect(() => recorder.bootstrap(false)).not.toThrow();
    expect(recorder.status()).toEqual({ available: false, lifeId: 0, mode: 'prod' });
    expect(electronHarness.start).toHaveBeenCalled();
    recorder.close();
  });

  it('imports a lifeId=0 emergency record after the recorder database recovers', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-recorder-journal-recovery-'));
    const diagnostics = path.join(root, 'diagnostics', 'prod');
    fs.mkdirSync(diagnostics, { recursive: true });
    fs.writeFileSync(path.join(diagnostics, 'emergency.ndjson'), `${JSON.stringify({
      schemaVersion: 1,
      lifeId: 0,
      occurredAt: Date.now() - 1_000,
      type: 'main_fatal',
      errorName: 'Error',
      errorMessage: 'fatal while recorder database was unavailable',
      stack: 'Error: fatal',
      origin: 'uncaughtException',
      logTail: [],
    })}\n`);
    setRootForTesting(root);

    const recorder = new CrashRecorder();
    recorder.bootstrap(false);

    const incidents = recorder.listIncidents({ limit: 10 });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].kind).toBe('main_fatal');
    expect(incidents[0].lifeId).toBe(recorder.status().lifeId);
    recorder.close();
  });
});
