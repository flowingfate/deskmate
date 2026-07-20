import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { DiagnosticsStore } from '../DiagnosticsStore';
import { LifeCycleCoordinator, nextLifeId } from '../LifeCycleCoordinator';
import type { IncidentRecord, LifecycleRecord } from '../types';

function lifecycle(lifeId: number, startedAt: number): LifecycleRecord {
  return {
    lifeId,
    startedAt,
    state: 'running',
    closingAt: null,
    endedAt: null,
    shutdownReason: null,
    exitCode: null,
    appVersion: '1.0.0',
    electronVersion: '41.0.0',
    platform: process.platform,
    arch: process.arch,
  };
}

function incident(id: string, lifeId: number, occurredAt: number): IncidentRecord {
  return {
    id,
    lifeId,
    kind: 'renderer_crash',
    severity: 'fatal',
    state: 'finalized',
    fingerprint: `fingerprint-${id}`,
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
          profileId: 'p_test',
          route: '/agent',
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
    logs: { schemaVersion: 1, entries: [], truncated: false },
    artifacts: { schemaVersion: 1, items: [], truncated: false },
    createdAt: occurredAt,
    finalizedAt: occurredAt,
  };
}

describe('DiagnosticsStore lifecycle and retention', () => {
  let root: string;
  let store: DiagnosticsStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crash-recorder-store-'));
    store = new DiagnosticsStore(root);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('commits a clean lifecycle without creating an Incident', () => {
    store.startLifecycle(lifecycle(1, 100));
    store.beginShutdown(1, 'menu', 200);
    store.finishShutdown(1, 0, 300);

    expect(store.lifecycle(1)).toMatchObject({
      state: 'clean',
      shutdownReason: 'menu',
      exitCode: 0,
      closingAt: 200,
      endedAt: 300,
    });
    expect(store.listIncidents({ limit: 100 })).toEqual([]);
  });

  it('lists incident summaries without deserializing log snapshots', () => {
    store.startLifecycle(lifecycle(1, 100));
    store.saveIncident(incident('summary-only', 1, 200));

    const database = new Database(store.databasePath);
    database.prepare("UPDATE incidents SET logs_json = 'not-json' WHERE id = ?").run('summary-only');
    database.close();

    expect(store.listIncidents({ limit: 10 })).toMatchObject([{ incidentId: 'summary-only' }]);
  });

  it('retains at most 100 newest incidents', () => {
    store.startLifecycle(lifecycle(1, 1));
    for (let index = 0; index < 105; index += 1) {
      store.saveIncident(incident(`incident-${index}`, 1, 1_000 + index));
    }

    store.runRetention(2_000);

    const retained = store.listIncidents({ limit: 100 });
    expect(retained).toHaveLength(100);
    expect(retained[0].incidentId).toBe('incident-104');
    expect(retained.some((item) => item.incidentId === 'incident-0')).toBe(false);
  });

  it('retains at most 1000 lifecycles', () => {
    for (let lifeId = 1; lifeId <= 1_005; lifeId += 1) {
      store.startLifecycle(lifecycle(lifeId, lifeId));
    }

    store.runRetention(2_000);

    const verify = new Database(store.databasePath, { readonly: true });
    const row = verify.prepare<[], { count: number }>('SELECT count(*) AS count FROM lifecycles').get();
    verify.close();
    expect(row?.count).toBe(1_000);
  });

  it('cycles 200001 allocations and clears the reused life from both databases', () => {
    let value = 0;
    for (let index = 0; index < 200_001; index += 1) value = nextLifeId(value);
    expect(value).toBe(1);

    store.startLifecycle(lifecycle(1, 1));
    store.saveIncident(incident('stale-life-one', 1, 1));
    store.startLifecycle(lifecycle(200_000, 2));

    const logDbPath = path.join(root, 'logs.db');
    const logDb = new Database(logDbPath);
    logDb.exec('CREATE TABLE app_logs (id INTEGER PRIMARY KEY, life_id INTEGER NOT NULL, ts INTEGER NOT NULL)');
    logDb.prepare('INSERT INTO app_logs (id, life_id, ts) VALUES (?, ?, ?)').run(1, 1, 1);
    logDb.prepare('INSERT INTO app_logs (id, life_id, ts) VALUES (?, ?, ?)').run(2, 200_000, 2);
    logDb.close();

    const coordinator = new LifeCycleCoordinator(store, logDbPath, {
      appVersion: '1.0.0',
      electronVersion: '41.0.0',
      platform: process.platform,
      arch: process.arch,
    });
    expect(coordinator.allocate(3).lifeId).toBe(1);
    expect(store.incident('stale-life-one')).toBeNull();

    const verifyLogs = new Database(logDbPath, { readonly: true });
    const staleRows = verifyLogs.prepare<[number], { count: number }>('SELECT count(*) AS count FROM app_logs WHERE life_id = ?').get(1);
    verifyLogs.close();
    expect(staleRows?.count).toBe(0);
  });
});
