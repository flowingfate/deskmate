import Database from 'better-sqlite3';
import type { Database as BetterDatabase } from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  IncidentArtifactsSnapshot,
  IncidentKind,
  IncidentListFilter,
  IncidentLogsSnapshot,
  IncidentPayloadSnapshot,
  IncidentRecord,
  IncidentSeverity,
  IncidentState,
  IncidentSummary,
  LifecycleRecord,
  LifecycleState,
} from './types';
import { MAX_INCIDENT_LOG_BYTES } from './types';

const PAYLOAD_MAX_BYTES = 256 * 1024;
const LOGS_MAX_BYTES = MAX_INCIDENT_LOG_BYTES;
const ARTIFACTS_MAX_BYTES = 32 * 1024;
const INCIDENT_LIMIT = 100;
const LIFECYCLE_LIMIT = 1000;
const INCIDENT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const ALWAYS_KEEP_INCIDENTS = 10;

const DDL = `
CREATE TABLE IF NOT EXISTS lifecycles (
  life_id          INTEGER PRIMARY KEY CHECK (life_id BETWEEN 1 AND 200000),
  started_at       INTEGER NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('running','closing','clean','interrupted')),
  closing_at       INTEGER,
  ended_at         INTEGER,
  shutdown_reason  TEXT,
  exit_code        INTEGER,
  app_version      TEXT NOT NULL,
  electron_version TEXT NOT NULL,
  platform         TEXT NOT NULL,
  arch             TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  id               TEXT PRIMARY KEY,
  life_id          INTEGER NOT NULL REFERENCES lifecycles(life_id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  severity         TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('open','finalized')),
  fingerprint      TEXT NOT NULL,
  summary          TEXT NOT NULL,
  first_event_at   INTEGER NOT NULL,
  last_event_at    INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  payload_json     TEXT NOT NULL,
  logs_json        TEXT NOT NULL,
  artifacts_json   TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  finalized_at     INTEGER
);
CREATE INDEX IF NOT EXISTS incidents_by_time ON incidents(first_event_at DESC);
CREATE INDEX IF NOT EXISTS incidents_by_life ON incidents(life_id, first_event_at DESC);
CREATE INDEX IF NOT EXISTS incidents_by_fingerprint ON incidents(life_id, fingerprint, last_event_at DESC);
`;

interface LifecycleRow {
  life_id: number;
  started_at: number;
  state: LifecycleState;
  closing_at: number | null;
  ended_at: number | null;
  shutdown_reason: string | null;
  exit_code: number | null;
  app_version: string;
  electron_version: string;
  platform: string;
  arch: string;
}

interface IncidentRow {
  id: string;
  life_id: number;
  kind: IncidentKind;
  severity: IncidentSeverity;
  state: IncidentState;
  fingerprint: string;
  summary: string;
  first_event_at: number;
  last_event_at: number;
  occurrence_count: number;
  payload_json: string;
  logs_json: string;
  artifacts_json: string;
  created_at: number;
  finalized_at: number | null;
}
type IncidentSummaryRow = Pick<
  IncidentRow,
  | 'id'
  | 'life_id'
  | 'kind'
  | 'severity'
  | 'summary'
  | 'first_event_at'
  | 'last_event_at'
  | 'occurrence_count'
  | 'payload_json'
  | 'artifacts_json'
>;

const INCIDENT_SUMMARY_COLUMNS = `
  id, life_id, kind, severity, summary, first_event_at, last_event_at,
  occurrence_count, payload_json, artifacts_json
`;


interface LifeRefRow {
  life_id: number;
}

interface ArtifactJsonRow {
  artifacts_json: string;
}

function serializeBounded(value: IncidentPayloadSnapshot | IncidentLogsSnapshot | IncidentArtifactsSnapshot, maxBytes: number, label: string): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > maxBytes) throw new Error(`${label} snapshot exceeds its storage limit.`);
  return json;
}

function lifecycleFromRow(row: LifecycleRow): LifecycleRecord {
  return {
    lifeId: row.life_id,
    startedAt: row.started_at,
    state: row.state,
    closingAt: row.closing_at,
    endedAt: row.ended_at,
    shutdownReason: row.shutdown_reason,
    exitCode: row.exit_code,
    appVersion: row.app_version,
    electronVersion: row.electron_version,
    platform: row.platform,
    arch: row.arch,
  };
}

function incidentFromRow(row: IncidentRow): IncidentRecord {
  const payload: IncidentPayloadSnapshot = JSON.parse(row.payload_json);
  const logs: IncidentLogsSnapshot = JSON.parse(row.logs_json);
  const artifacts: IncidentArtifactsSnapshot = JSON.parse(row.artifacts_json);
  return {
    id: row.id,
    lifeId: row.life_id,
    kind: row.kind,
    severity: row.severity,
    state: row.state,
    fingerprint: row.fingerprint,
    summary: row.summary,
    firstEventAt: row.first_event_at,
    lastEventAt: row.last_event_at,
    occurrenceCount: row.occurrence_count,
    payload,
    logs,
    artifacts,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
  };
}
function eventSummary(payload: IncidentPayloadSnapshot): { process: string; window: string | null; profileId: string | null } {
  for (const event of payload.events) {
    if (event.type === 'renderer_gone') {
      return {
        process: 'renderer',
        window: `${event.window.kind}:${event.window.windowId}`,
        profileId: event.window.kind === 'profile-main' ? event.window.profileId : null,
      };
    }
    if (event.type === 'child_gone') return { process: event.processType, window: null, profileId: null };
    if (event.type === 'main_fatal') return { process: 'main', window: null, profileId: null };
  }
  return { process: 'main', window: null, profileId: null };
}

function incidentSummaryFromRow(row: IncidentSummaryRow): IncidentSummary {
  const payload: IncidentPayloadSnapshot = JSON.parse(row.payload_json);
  const artifacts: IncidentArtifactsSnapshot = JSON.parse(row.artifacts_json);
  const source = eventSummary(payload);
  const storedArtifacts = artifacts.items.filter((artifact) => artifact.state === 'stored');
  return {
    incidentId: row.id,
    lifeId: row.life_id,
    kind: row.kind,
    severity: row.severity,
    summary: row.summary,
    firstEventAt: row.first_event_at,
    lastEventAt: row.last_event_at,
    appVersion: payload.system.appVersion,
    occurrenceCount: row.occurrence_count,
    process: source.process,
    window: source.window,
    profileId: source.profileId,
    artifactCount: storedArtifacts.length,
    artifactBytes: storedArtifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
  };
}


export class DiagnosticsStore {
  private readonly db: BetterDatabase;
  public readonly databasePath: string;

  public constructor(diagnosticsDir: string) {
    fs.mkdirSync(diagnosticsDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(diagnosticsDir, 0o700);
    this.databasePath = path.join(diagnosticsDir, 'crash-recorder.db');
    const database = new Database(this.databasePath);
    try {
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = FULL');
      database.pragma('foreign_keys = ON');
      database.pragma('busy_timeout = 1000');
      database.exec(DDL);
      fs.chmodSync(this.databasePath, 0o600);
    } catch (error) {
      database.close();
      throw error;
    }
    this.db = database;
  }

  public latestLifecycle(): LifecycleRecord | null {
    const row = this.db
      .prepare<[], LifecycleRow>('SELECT * FROM lifecycles ORDER BY started_at DESC LIMIT 1')
      .get();
    return row ? lifecycleFromRow(row) : null;
  }

  public lifecycle(lifeId: number): LifecycleRecord | null {
    const row = this.db
      .prepare<[number], LifecycleRow>('SELECT * FROM lifecycles WHERE life_id = ?')
      .get(lifeId);
    return row ? lifecycleFromRow(row) : null;
  }

  public deleteLifecycle(lifeId: number): void {
    this.db.prepare('DELETE FROM lifecycles WHERE life_id = ?').run(lifeId);
  }

  public startLifecycle(record: LifecycleRecord): void {
    this.db.prepare(`
      INSERT INTO lifecycles (
        life_id, started_at, state, closing_at, ended_at, shutdown_reason,
        exit_code, app_version, electron_version, platform, arch
      ) VALUES (?, ?, 'running', NULL, NULL, NULL, NULL, ?, ?, ?, ?)
    `).run(record.lifeId, record.startedAt, record.appVersion, record.electronVersion, record.platform, record.arch);
  }

  public markInterrupted(lifeId: number, endedAt: number): void {
    this.db.prepare("UPDATE lifecycles SET state = 'interrupted', ended_at = ? WHERE life_id = ? AND state IN ('running','closing')")
      .run(endedAt, lifeId);
  }

  public beginShutdown(lifeId: number, reason: string, closingAt: number): void {
    this.db.prepare("UPDATE lifecycles SET state = 'closing', closing_at = ?, shutdown_reason = ? WHERE life_id = ? AND state = 'running'")
      .run(closingAt, reason, lifeId);
  }

  public finishShutdown(lifeId: number, exitCode: number, endedAt: number): void {
    this.db.prepare("UPDATE lifecycles SET state = 'clean', ended_at = ?, exit_code = ? WHERE life_id = ? AND state IN ('running','closing')")
      .run(endedAt, exitCode, lifeId);
  }

  public saveIncident(incident: IncidentRecord): void {
    const payload = serializeBounded(incident.payload, PAYLOAD_MAX_BYTES, 'payload');
    const logs = serializeBounded(incident.logs, LOGS_MAX_BYTES, 'logs');
    const artifacts = serializeBounded(incident.artifacts, ARTIFACTS_MAX_BYTES, 'artifacts');
    this.db.prepare(`
      INSERT INTO incidents (
        id, life_id, kind, severity, state, fingerprint, summary, first_event_at,
        last_event_at, occurrence_count, payload_json, logs_json, artifacts_json,
        created_at, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        severity = excluded.severity,
        state = excluded.state,
        fingerprint = excluded.fingerprint,
        summary = excluded.summary,
        last_event_at = excluded.last_event_at,
        occurrence_count = excluded.occurrence_count,
        payload_json = excluded.payload_json,
        logs_json = excluded.logs_json,
        artifacts_json = excluded.artifacts_json,
        finalized_at = excluded.finalized_at
    `).run(
      incident.id,
      incident.lifeId,
      incident.kind,
      incident.severity,
      incident.state,
      incident.fingerprint,
      incident.summary,
      incident.firstEventAt,
      incident.lastEventAt,
      incident.occurrenceCount,
      payload,
      logs,
      artifacts,
      incident.createdAt,
      incident.finalizedAt,
    );
  }

  public incident(id: string): IncidentRecord | null {
    const row = this.db.prepare<[string], IncidentRow>('SELECT * FROM incidents WHERE id = ?').get(id);
    return row ? incidentFromRow(row) : null;
  }

  public openIncidents(): IncidentRecord[] {
    return this.db.prepare<[], IncidentRow>("SELECT * FROM incidents WHERE state = 'open' ORDER BY first_event_at ASC")
      .all()
      .map(incidentFromRow);
  }

  public listIncidents(filter: IncidentListFilter): IncidentSummary[] {
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
    let rows: IncidentSummaryRow[];
    if (filter.kind && filter.since !== undefined) {
      rows = this.db.prepare<[IncidentKind, number, number], IncidentSummaryRow>(`SELECT ${INCIDENT_SUMMARY_COLUMNS} FROM incidents WHERE kind = ? AND first_event_at >= ? ORDER BY first_event_at DESC LIMIT ?`)
        .all(filter.kind, filter.since, limit);
    } else if (filter.kind) {
      rows = this.db.prepare<[IncidentKind, number], IncidentSummaryRow>(`SELECT ${INCIDENT_SUMMARY_COLUMNS} FROM incidents WHERE kind = ? ORDER BY first_event_at DESC LIMIT ?`)
        .all(filter.kind, limit);
    } else if (filter.since !== undefined) {
      rows = this.db.prepare<[number, number], IncidentSummaryRow>(`SELECT ${INCIDENT_SUMMARY_COLUMNS} FROM incidents WHERE first_event_at >= ? ORDER BY first_event_at DESC LIMIT ?`)
        .all(filter.since, limit);
    } else {
      rows = this.db.prepare<[number], IncidentSummaryRow>(`SELECT ${INCIDENT_SUMMARY_COLUMNS} FROM incidents ORDER BY first_event_at DESC LIMIT ?`)
        .all(limit);
    }
    return rows.map(incidentSummaryFromRow);
  }

  public runRetention(now = Date.now()): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM incidents WHERE id IN (
        SELECT id FROM incidents ORDER BY first_event_at DESC LIMIT -1 OFFSET ?
      )`).run(INCIDENT_LIMIT);
      this.db.prepare(`DELETE FROM incidents
        WHERE first_event_at < ?
          AND id NOT IN (SELECT id FROM incidents ORDER BY first_event_at DESC LIMIT ?)`)
        .run(now - INCIDENT_MAX_AGE_MS, ALWAYS_KEEP_INCIDENTS);
      const allLifecycles = this.db.prepare<[], LifeRefRow>('SELECT life_id FROM lifecycles ORDER BY started_at DESC').all();
      const incidentLifecycles = this.db.prepare<[], LifeRefRow>('SELECT DISTINCT life_id FROM incidents').all();
      const keep = new Set(incidentLifecycles.map((row) => row.life_id));
      for (const row of allLifecycles.slice(0, 2)) keep.add(row.life_id);
      for (const row of allLifecycles) {
        if (keep.size >= LIFECYCLE_LIMIT) break;
        keep.add(row.life_id);
      }
      const deleteLifecycle = this.db.prepare('DELETE FROM lifecycles WHERE life_id = ?');
      for (const row of allLifecycles) {
        if (!keep.has(row.life_id)) deleteLifecycle.run(row.life_id);
      }
    })();
  }

  public referencedArtifactHashes(): Set<string> {
    const hashes = new Set<string>();
    const rows = this.db.prepare<[], ArtifactJsonRow>('SELECT artifacts_json FROM incidents').all();
    for (const row of rows) {
      const snapshot: IncidentArtifactsSnapshot = JSON.parse(row.artifacts_json);
      for (const artifact of snapshot.items) hashes.add(artifact.hash);
    }
    return hashes;
  }

  public close(): void {
    this.db.close();
  }
}
