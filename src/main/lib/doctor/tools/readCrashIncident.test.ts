import { describe, expect, it, vi } from 'vitest';
import type { IncidentRecord } from '@main/lib/crash-recorder/types';

const crashRecorder = vi.hoisted(() => ({
  readIncident: vi.fn(),
}));

vi.mock('@main/lib/crash-recorder', () => ({ crashRecorder }));

import { executeReadCrashIncident } from './readCrashIncident';

function incident(): IncidentRecord {
  return {
    id: 'incident-1',
    lifeId: 1,
    kind: 'main_fatal',
    severity: 'fatal',
    state: 'finalized',
    fingerprint: 'fingerprint',
    summary: 'Main process fatal error',
    firstEventAt: 1,
    lastEventAt: 2,
    occurrenceCount: 1,
    payload: {
      schemaVersion: 1,
      events: [{
        type: 'main_fatal',
        occurredAt: 1,
        errorName: 'Error',
        errorMessage: 'Failed at /Users/alice/project/main.ts with token=super-secret',
        stack: 'Error: failed\n    at main (/Users/alice/project/main.ts:12:4)',
        origin: 'uncaughtException',
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
        ts: 1,
        level: 50,
        processType: 'main',
        pid: 1,
        component: 'test',
        msg: 'Opening /tmp/secret.json?token=super-secret',
        traceId: null,
        spanId: null,
        parentSpanId: null,
        windowId: null,
        lifeId: 1,
        errorMessage: 'Read /Users/alice/.deskmate/token.txt',
        errorStack: 'Error\n    at read (/Users/alice/.deskmate/token.txt:1:1)',
        context: { route: '/Users/alice/private' },
      }],
      truncated: false,
    },
    artifacts: { schemaVersion: 1, items: [], truncated: false },
    createdAt: 1,
    finalizedAt: 2,
  };
}

describe('readCrashIncident', () => {
  it('redacts absolute paths and credentials before returning diagnostic details', async () => {
    crashRecorder.readIncident.mockReturnValue(incident());

    const result = await executeReadCrashIncident({ incidentId: 'incident-1' });

    expect(result).not.toContain('/Users/alice');
    expect(result).not.toContain('/tmp/secret.json');
    expect(result).not.toContain('super-secret');
    expect(result).toContain('<PATH>');
    expect(result).toContain('<REDACTED>');
  });
});
