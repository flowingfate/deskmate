import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DiagnosticsStore } from '../DiagnosticsStore';
import { DiagnosticLogRing } from '../DiagnosticLogRing';
import { EmergencyJournal } from '../EmergencyJournal';
import { IncidentCorrelator } from '../IncidentCorrelator';
import { MinidumpCollector } from '../MinidumpCollector';
import type { EmergencyMainFatalRecord } from '../types';

function fatalRecord(occurredAt: number): EmergencyMainFatalRecord {
  return {
    schemaVersion: 1,
    lifeId: 1,
    occurredAt,
    type: 'main_fatal',
    errorName: 'Error',
    errorMessage: 'fatal',
    stack: 'Error: fatal\n at main',
    origin: 'uncaughtException',
    logTail: [],
  };
}

describe('EmergencyJournal', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-journal-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists fatal evidence without logger or SQLite and ignores a truncated final line', () => {
    const journalPath = path.join(root, 'emergency.ndjson');
    const journal = new EmergencyJournal();
    journal.open(journalPath);
    journal.bindLife(1);
    journal.installFatalMonitor();

    journal.recordFatal(new Error('fatal after logger close'), 'uncaughtException');
    journal.close();

    const firstLine = fs.readFileSync(journalPath, 'utf8');
    expect(firstLine).toContain('fatal after logger close');
    fs.appendFileSync(journalPath, JSON.stringify(fatalRecord(Date.now())));

    const imported = journal.importRecords(journalPath);
    expect(imported).toHaveLength(1);
    expect(imported[0].lifeId).toBe(1);
  });
});

describe('MinidumpCollector', () => {
  let root: string;
  let crashpad: string;
  let artifacts: string;
  let store: DiagnosticsStore;
  let correlator: IncidentCorrelator;
  let collector: MinidumpCollector;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-minidump-'));
    crashpad = path.join(root, 'crashpad');
    artifacts = path.join(root, 'artifacts');
    store = new DiagnosticsStore(root);
    store.startLifecycle({
      lifeId: 1,
      startedAt: 1,
      state: 'running',
      closingAt: null,
      endedAt: null,
      shutdownReason: null,
      exitCode: null,
      appVersion: '1.0.0',
      electronVersion: '41.0.0',
      platform: process.platform,
      arch: process.arch,
    });
    correlator = new IncidentCorrelator(store, new DiagnosticLogRing(), 1, '1.0.0', '41.0.0');
    collector = new MinidumpCollector(crashpad, artifacts, store, correlator, {
      collectionWindowMs: 900,
      scanIntervalMs: 50,
    });
  });

  afterEach(() => {
    correlator.finalizeAll();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('recursively discovers only regular stable dmp files and rejects symlink escapes', () => {
    const nested = path.join(crashpad, 'pending', 'completed');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(crashpad, 'settings.dat'), 'settings');
    fs.writeFileSync(path.join(nested, 'native.DMP'), 'dump');
    const outside = path.join(root, 'outside.dmp');
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(crashpad, 'escaped.dmp'));

    const candidates = collector.discoverCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].filePath).toBe(path.join(nested, 'native.DMP'));
  });

  it('retries a growing dump until it becomes stable, then associates the complete file', async () => {
    const dump = path.join(crashpad, 'growing.dmp');
    fs.writeFileSync(dump, 'first');
    const modifiedAt = fs.statSync(dump).mtimeMs;
    correlator.record({
      type: 'main_fatal',
      occurredAt: modifiedAt,
      errorName: 'NativeCrash',
      errorMessage: 'native crash',
      stack: '',
      origin: 'uncaughtException',
    });

    collector.collectSoon(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    fs.appendFileSync(dump, 'second');
    await collector.waitForIdle();

    expect(fs.existsSync(dump)).toBe(false);
    expect(fs.readdirSync(artifacts)).toHaveLength(1);
  });

  it('discovers a dump that appears after the process-gone signal', async () => {
    const occurredAt = Date.now();
    const dump = path.join(crashpad, 'delayed.dmp');
    correlator.record({
      type: 'main_fatal',
      occurredAt,
      errorName: 'NativeCrash',
      errorMessage: 'native crash',
      stack: '',
      origin: 'uncaughtException',
    });

    collector.collectSoon(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    fs.writeFileSync(dump, 'delayed-native-dump');
    await collector.waitForIdle();

    expect(fs.existsSync(dump)).toBe(false);
    expect(fs.readdirSync(artifacts)).toHaveLength(1);
  });

  it('retains the Crashpad source without creating an orphan when the artifact relation is not committed', async () => {
    const dump = path.join(crashpad, 'uncommitted.dmp');
    fs.writeFileSync(dump, 'uncommitted-native-dump');
    const modifiedAt = fs.statSync(dump).mtimeMs;
    correlator.record({
      type: 'main_fatal',
      occurredAt: modifiedAt,
      errorName: 'NativeCrash',
      errorMessage: 'native crash',
      stack: '',
      origin: 'uncaughtException',
    });
    const attachSpy = vi.spyOn(correlator, 'attachArtifact').mockReturnValue(null);

    await collector.collect(1);

    expect(fs.existsSync(dump)).toBe(true);
    expect(fs.readdirSync(artifacts)).toEqual([]);
    attachSpy.mockRestore();
  });

  it('keeps an unassociated dump in the Crashpad raw queue', async () => {
    const dump = path.join(crashpad, 'unassociated.dmp');
    fs.writeFileSync(dump, 'unassociated-native-dump');

    await collector.collect(1);

    expect(fs.existsSync(dump)).toBe(true);
    expect(fs.readdirSync(artifacts)).toEqual([]);
  });
  it('keeps a dump raw when multiple incidents could claim it', async () => {
    const dump = path.join(crashpad, 'ambiguous.dmp');
    fs.writeFileSync(dump, 'ambiguous-native-dump');
    const modifiedAt = fs.statSync(dump).mtimeMs;
    correlator.record({
      type: 'main_fatal',
      occurredAt: modifiedAt - 5_000,
      errorName: 'FirstNativeCrash',
      errorMessage: 'first native crash',
      stack: '',
      origin: 'uncaughtException',
    });
    correlator.record({
      type: 'main_fatal',
      occurredAt: modifiedAt - 1_000,
      errorName: 'SecondNativeCrash',
      errorMessage: 'second native crash',
      stack: '',
      origin: 'uncaughtException',
    });

    await collector.collect(1);

    expect(fs.existsSync(dump)).toBe(true);
    expect(fs.readdirSync(artifacts)).toEqual([]);
  });

  it('deduplicates identical dumps by SHA-256 and associates one artifact', async () => {
    const dump = path.join(crashpad, 'first.dmp');
    fs.writeFileSync(dump, 'same-native-dump');
    const modifiedAt = fs.statSync(dump).mtimeMs;
    correlator.record({
      type: 'main_fatal',
      occurredAt: modifiedAt,
      errorName: 'NativeCrash',
      errorMessage: 'native crash',
      stack: '',
      origin: 'uncaughtException',
    });

    await collector.collect(1);
    fs.writeFileSync(path.join(crashpad, 'second.dmp'), 'same-native-dump');
    await collector.collect(1);
    correlator.finalizeAll();

    expect(fs.readdirSync(artifacts)).toHaveLength(1);
    const record = store.incident(store.listIncidents({ limit: 1 })[0].incidentId);
    expect(record?.artifacts.items).toHaveLength(1);
    expect(record?.artifacts.items[0].state).toBe('stored');
  });
});
