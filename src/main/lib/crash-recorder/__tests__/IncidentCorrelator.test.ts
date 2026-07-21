import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DiagnosticsStore } from '../DiagnosticsStore';
import { DiagnosticLogRing } from '../DiagnosticLogRing';
import { IncidentCorrelator } from '../IncidentCorrelator';
import type { CrashEvent } from '../types';

function rendererEvent(occurredAt: number, profileId = 'p_a'): Extract<CrashEvent, { type: 'renderer_gone' }> {
  return {
    type: 'renderer_gone',
    occurredAt,
    reason: 'crashed',
    exitCode: 1,
    window: {
      kind: 'profile-main',
      windowId: profileId === 'p_a' ? 10 : 20,
      webContentsId: profileId === 'p_a' ? 11 : 21,
      rendererProcessId: profileId === 'p_a' ? 12 : 22,
      profileId,
      route: '/agent',
    },
  };
}

describe('IncidentCorrelator', () => {
  let root: string;
  let store: DiagnosticsStore;
  let correlator: IncidentCorrelator;
  let ring: DiagnosticLogRing;
  let now: number;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-correlator-'));
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
    now = Date.now();
    ring = new DiagnosticLogRing();
    correlator = new IncidentCorrelator(store, ring, 1, '1.0.0', '41.0.0');
  });

  afterEach(() => {
    correlator.finalizeAll();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('merges renderer, GPU, and Network Service signals into one incident', () => {
    correlator.record(rendererEvent(now));
    correlator.record({
      type: 'child_gone',
      occurredAt: now + 5,
      processType: 'GPU',
      reason: 'killed',
      exitCode: 15,
      serviceName: null,
      processName: null,
    });
    correlator.record({
      type: 'child_gone',
      occurredAt: now + 11,
      processType: 'Utility',
      reason: 'killed',
      exitCode: 15,
      serviceName: 'network.mojom.NetworkService',
      processName: 'Network Service',
    });
    correlator.finalizeAll();

    const incidents = store.listIncidents({ limit: 100 });
    expect(incidents).toHaveLength(1);
    const record = store.incident(incidents[0].incidentId);
    expect(record?.kind).toBe('renderer_crash');
    expect(record?.payload.events).toHaveLength(3);
    expect(record?.occurrenceCount).toBe(1);
  });

  it('never downgrades an incident after a higher-priority root event arrives', () => {
    correlator.record({ ...rendererEvent(now), reason: 'memory-eviction' });
    correlator.record(rendererEvent(now + 1));
    correlator.record({
      type: 'child_gone',
      occurredAt: now + 2,
      processType: 'GPU',
      reason: 'killed',
      exitCode: 15,
      serviceName: null,
      processName: null,
    });
    correlator.finalizeAll();

    const record = store.incident(store.listIncidents({ limit: 1 })[0].incidentId);
    expect(record?.kind).toBe('renderer_crash');
    expect(record?.severity).toBe('fatal');
    expect(record?.occurrenceCount).toBe(1);
  });

  it('keeps the triggering Profile A identity when Profile B remains open', () => {
    correlator.record(rendererEvent(now, 'p_a'));
    correlator.finalizeAll();

    const summary = store.listIncidents({ limit: 1 })[0];
    expect(summary.profileId).toBe('p_a');
    expect(summary.window).toBe('profile-main:10');
  });

  it('keeps independent renderer crashes separate inside the causal window', () => {
    correlator.record(rendererEvent(now, 'p_a'));
    correlator.record(rendererEvent(now + 1, 'p_b'));
    correlator.finalizeAll();

    const incidents = store.listIncidents({ limit: 100 });
    expect(incidents).toHaveLength(2);
    expect(new Set(incidents.map((incident) => incident.profileId))).toEqual(new Set(['p_a', 'p_b']));
  });

  it('never merges open incidents across lifecycle boundaries', () => {
    store.startLifecycle({
      lifeId: 2,
      startedAt: now + 1,
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
    correlator.record(rendererEvent(now), 1);
    correlator.record(rendererEvent(now + 1), 2);
    correlator.finalizeAll();

    const incidents = store.listIncidents({ limit: 100 });
    expect(incidents).toHaveLength(2);
    expect(new Set(incidents.map((incident) => incident.lifeId))).toEqual(new Set([1, 2]));
  });

  it('deduplicates 100 matching events and bounds the event snapshot', () => {
    for (let index = 0; index < 100; index += 1) {
      correlator.record(rendererEvent(now + index));
    }
    correlator.finalizeAll();

    const record = store.incident(store.listIncidents({ limit: 1 })[0].incidentId);
    expect(record?.occurrenceCount).toBe(100);
    expect(record?.payload.events).toHaveLength(64);
    expect(record?.payload.eventsTruncated).toBe(true);
  });

  it('truncates a noisy log snapshot by bytes and still persists the incident', () => {
    for (let index = 0; index < 200; index += 1) {
      ring.append('error', { msg: `log-${index}-${'x'.repeat(4_096)}`, mod: 'test.noisy' }, {});
    }

    const incident = correlator.record(rendererEvent(Date.now() + 1));
    expect(incident?.logs.truncated).toBe(true);
    expect(store.incident(incident?.id ?? '')).not.toBeNull();
  });

  it('does not confirm an artifact relation when the database commit fails', () => {
    const incident = correlator.record(rendererEvent(now));
    expect(incident).not.toBeNull();
    const saveSpy = vi.spyOn(store, 'saveIncident').mockImplementation(() => {
      throw new Error('disk full');
    });

    const attached = correlator.attachArtifact(incident?.id ?? '', {
      hash: 'failed-commit',
      sizeBytes: 4,
      primary: false,
      state: 'stored',
      discoveredAt: now,
    });

    expect(attached).toBeNull();
    expect(incident?.artifacts.items).toEqual([]);
    saveSpy.mockRestore();
  });

  it('does not create a second abnormal termination when direct fatal evidence exists', () => {
    correlator.record({
      type: 'main_fatal',
      occurredAt: now,
      errorName: 'Error',
      errorMessage: 'fatal',
      stack: 'Error: fatal\n at main',
      origin: 'uncaughtException',
    });
    expect(correlator.hasDirectCrashEvidence(1)).toBe(true);

    const kinds = store.listIncidents({ limit: 100 }).map((item) => item.kind);
    expect(kinds).toEqual(['main_fatal']);
  });
});
