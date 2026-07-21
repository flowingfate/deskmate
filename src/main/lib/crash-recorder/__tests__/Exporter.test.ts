import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { DiagnosticsStore } from '../DiagnosticsStore';
import { exportCrashIncident } from '../exporter';
import type { IncidentRecord } from '../types';

const DOWNLOADS = '/tmp/test';

function makeIncident(id: string): IncidentRecord {
  const occurredAt = Date.now();
  return {
    id,
    lifeId: 1,
    kind: 'renderer_crash',
    severity: 'fatal',
    state: 'finalized',
    fingerprint: 'fingerprint',
    summary: 'Renderer crashed',
    firstEventAt: occurredAt,
    lastEventAt: occurredAt,
    occurrenceCount: 1,
    payload: {
      schemaVersion: 1,
      events: [{
        type: 'renderer_gone',
        occurredAt,
        reason: 'crashed',
        exitCode: 1,
        window: {
          kind: 'profile-main',
          windowId: 1,
          webContentsId: 2,
          rendererProcessId: 3,
          profileId: 'p_sensitive',
          route: '/agent/a_01ARZ3NDEKTSV4RRFFQ69G5FAV/s_01ARZ3NDEKTSV4RRFFQ69G5FAW?token=secret',
        },
      }],
      system: {
        appVersion: '1.0.0',
        electronVersion: '41.0.0',
        platform: process.platform,
        arch: process.arch,
        processUptimeMs: 1,
        systemUptimeMs: 1,
        totalMemoryBytes: 1,
        freeMemoryBytes: 1,
      },
      eventsTruncated: false,
    },
    logs: {
      schemaVersion: 1,
      entries: [{
        ts: occurredAt,
        level: 50,
        processType: 'renderer',
        pid: 1,
        component: 'test',
        msg: 'Agent a_01ARZ3NDEKTSV4RRFFQ69G5FAV opened https://example.com/private/s_01ARZ3NDEKTSV4RRFFQ69G5FAW?q=secret',
        traceId: null,
        spanId: null,
        parentSpanId: null,
        windowId: 2,
        lifeId: 1,
        errorMessage: null,
        errorStack: null,
        context: {
          agentId: 'a_01ARZ3NDEKTSV4RRFFQ69G5FAV',
          sessionId: 's_01ARZ3NDEKTSV4RRFFQ69G5FAW',
          route: '/agent/a_01ARZ3NDEKTSV4RRFFQ69G5FAV/s_01ARZ3NDEKTSV4RRFFQ69G5FAW?q=secret',
        },
      }],
      truncated: false,
    },
    artifacts: {
      schemaVersion: 1,
      items: [{
        hash: 'abc123',
        sizeBytes: 4,
        primary: true,
        state: 'stored',
        discoveredAt: occurredAt,
      }],
      truncated: false,
    },
    createdAt: occurredAt,
    finalizedAt: occurredAt,
  };
}

describe('crash incident exporter', () => {
  let root: string;
  let artifactDirectory: string;
  let store: DiagnosticsStore;
  let outputs: string[];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-exporter-'));
    artifactDirectory = path.join(root, 'artifacts');
    fs.mkdirSync(artifactDirectory);
    fs.mkdirSync(DOWNLOADS, { recursive: true });
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
    store.saveIncident(makeIncident('export-test'));
    fs.writeFileSync(path.join(artifactDirectory, 'abc123.dmp'), 'dump');
    outputs = [];
  });

  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
    for (const output of outputs) fs.rmSync(output, { force: true });
  });

  it('excludes minidumps and private machine fields by default', async () => {
    const result = await exportCrashIncident(store, artifactDirectory, 'export-test', {
      includeMinidumps: false,
      confirmedSensitiveMinidumps: false,
      confirmedLargeExport: false,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    outputs.push(result.filePath);

    const zip = await JSZip.loadAsync(fs.readFileSync(result.filePath));
    expect(Object.keys(zip.files).some((name) => name.endsWith('.dmp'))).toBe(false);
    const events = await zip.file('events.json')?.async('string');
    expect(events).toContain('<PROFILE>');
    expect(events).not.toContain('p_sensitive');
    expect(events).not.toContain(os.hostname());
    expect(events).toContain('<AGENT>');
    expect(events).toContain('<SESSION>');
    expect(events).not.toContain('a_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(events).not.toContain('s_01ARZ3NDEKTSV4RRFFQ69G5FAW');
    expect(events).not.toContain('token=secret');
    const logs = await zip.file('logs.jsonl')?.async('string');
    expect(logs).toContain('https://example.com/private/<SESSION>');
    expect(logs).not.toContain('q=secret');
    expect(logs).not.toContain('a_01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(logs).not.toContain('s_01ARZ3NDEKTSV4RRFFQ69G5FAW');
  });

  it('requires explicit consent before including minidumps', async () => {
    const denied = await exportCrashIncident(store, artifactDirectory, 'export-test', {
      includeMinidumps: true,
      confirmedSensitiveMinidumps: false,
      confirmedLargeExport: false,
    });
    expect(denied).toMatchObject({ success: false });

    const allowed = await exportCrashIncident(store, artifactDirectory, 'export-test', {
      includeMinidumps: true,
      confirmedSensitiveMinidumps: true,
      confirmedLargeExport: false,
    });
    expect(allowed.success).toBe(true);
    if (!allowed.success) return;
    outputs.push(allowed.filePath);
    const zip = await JSZip.loadAsync(fs.readFileSync(allowed.filePath));
    expect(zip.file('artifacts/abc123.dmp')).not.toBeNull();
  });
});
