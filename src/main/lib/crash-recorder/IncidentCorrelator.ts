import { createHash, randomUUID } from 'node:crypto';
import * as os from 'node:os';
import type { DiagnosticsStore } from './DiagnosticsStore';
import type { DiagnosticLogRing } from './DiagnosticLogRing';
import type {
  CrashEvent,
  EmergencyMainFatalRecord,
  IncidentKind,
  IncidentRecord,
  IncidentSeverity,
  MinidumpArtifact,
  SystemSnapshot,
} from './types';
import { MAX_INCIDENT_EVENTS, MAX_INCIDENT_LOG_BYTES, MAX_INCIDENT_LOGS } from './types';
import { safeStderr } from './safeStderr';

const CAUSAL_WINDOW_MS = 3_000;
const INCIDENT_WINDOW_MS = 10_000;
const PRE_CRASH_LOG_MS = 60_000;
const MAX_ARTIFACTS = 3;

interface Classification {
  kind: IncidentKind;
  severity: IncidentSeverity;
  summary: string;
}

function topStackFrame(stack: string): string {
  return stack.split('\n').map((line) => line.trim()).find((line) => line.startsWith('at ')) ?? '';
}

function classification(event: CrashEvent): Classification {
  switch (event.type) {
    case 'main_fatal':
      return { kind: 'main_fatal', severity: 'fatal', summary: `Main process fatal error: ${event.errorMessage}` };
    case 'renderer_gone':
      if (event.reason === 'memory-eviction') {
        return { kind: 'resource_eviction', severity: 'warning', summary: `Renderer memory eviction in window ${event.window.windowId}` };
      }
      if (event.reason === 'killed') {
        return { kind: 'renderer_crash', severity: 'error', summary: `Renderer killed in window ${event.window.windowId}` };
      }
      return { kind: 'renderer_crash', severity: 'fatal', summary: `Renderer ${event.reason} in window ${event.window.windowId}` };
    case 'child_gone':
      if (event.reason === 'killed') {
        return { kind: 'child_process_crash', severity: 'warning', summary: `${event.processType} process killed` };
      }
      return { kind: 'child_process_crash', severity: 'error', summary: `${event.processType} process ${event.reason}` };
    case 'run_interrupted':
      return { kind: 'abnormal_termination', severity: 'error', summary: 'Application terminated without entering shutdown' };
    case 'shutdown_interrupted':
      return { kind: 'abnormal_termination', severity: 'warning', summary: 'Application shutdown was interrupted' };
  }
}

function fingerprintParts(event: CrashEvent, appVersion: string): string[] {
  const info = classification(event);
  switch (event.type) {
    case 'main_fatal':
      return [info.kind, event.origin, event.errorName, topStackFrame(event.stack), appVersion];
    case 'renderer_gone':
      return [info.kind, event.reason, event.window.kind, String(event.window.webContentsId), appVersion];
    case 'child_gone':
      return [info.kind, event.reason, event.processType, event.serviceName ?? '', appVersion];
    case 'run_interrupted':
      return [info.kind, 'running', 'main', appVersion];
    case 'shutdown_interrupted':
      return [info.kind, 'closing', 'main', appVersion];
  }
}

function fingerprint(event: CrashEvent, appVersion: string): string {
  return createHash('sha256').update(fingerprintParts(event, appVersion).join('\n')).digest('hex');
}

function systemSnapshot(appVersion: string, electronVersion: string): SystemSnapshot {
  return {
    appVersion,
    electronVersion,
    platform: process.platform,
    arch: process.arch,
    processUptimeMs: Math.round(process.uptime() * 1000),
    systemUptimeMs: Math.round(os.uptime() * 1000),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
  };
}

function incidentPriority(kind: IncidentKind, severity: IncidentSeverity): number {
  if (kind === 'main_fatal') return 60;
  if (kind === 'renderer_crash') return severity === 'fatal' ? 50 : 20;
  if (kind === 'child_process_crash') return severity === 'error' ? 40 : 20;
  if (kind === 'abnormal_termination') return severity === 'error' ? 30 : 15;
  return 10;
}


function isSameRenderer(incident: IncidentRecord, event: CrashEvent): boolean {
  return event.type === 'renderer_gone' && incident.payload.events.some((existing) =>
    existing.type === 'renderer_gone' && existing.window.webContentsId === event.window.webContentsId,
  );
}

function canJoinCausalWindow(incident: IncidentRecord, event: CrashEvent): boolean {
  if (event.type === 'main_fatal') return true;
  if (event.type === 'renderer_gone') {
    return isSameRenderer(incident, event)
      || incident.payload.events.every((existing) => existing.type === 'child_gone');
  }
  if (event.type === 'child_gone') {
    return incident.payload.events.some(
      (existing) => existing.type === 'main_fatal' || existing.type === 'renderer_gone',
    );
  }
  return false;
}

export class IncidentCorrelator {
  private readonly open = new Map<string, IncidentRecord>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  public constructor(
    private readonly store: DiagnosticsStore,
    private readonly ring: DiagnosticLogRing,
    private readonly currentLifeId: number,
    private readonly appVersion: string,
    private readonly electronVersion: string,
  ) {
    for (const incident of store.openIncidents()) {
      this.open.set(incident.id, incident);
      if (Date.now() - incident.firstEventAt >= INCIDENT_WINDOW_MS) {
        this.finalizeRecord(incident);
      } else {
        this.scheduleFinalize(incident);
      }
    }
  }

  public record(event: CrashEvent, lifeId = this.currentLifeId, emergencyLogs = false): IncidentRecord | null {
    if (lifeId === 0) return null;
    const info = classification(event);
    const eventFingerprint = fingerprint(event, this.appVersion);
    const target = this.findTarget(lifeId, event, eventFingerprint);
    if (target) {
      const sameFingerprint = target.fingerprint === eventFingerprint;
      if (sameFingerprint) target.occurrenceCount += 1;
      target.lastEventAt = Math.max(target.lastEventAt, event.occurredAt);
      if (target.payload.events.length < MAX_INCIDENT_EVENTS) target.payload.events.push(event);
      else target.payload.eventsTruncated = true;
      if (incidentPriority(info.kind, info.severity) > incidentPriority(target.kind, target.severity)) {
        target.kind = info.kind;
        target.severity = info.severity;
        target.fingerprint = eventFingerprint;
        target.summary = info.summary;
      }
      if (!emergencyLogs) this.refreshLogs(target, event.occurredAt);
      return this.persist(target) ? target : null;
    }

    const logs = emergencyLogs
      ? { entries: [], truncated: false }
      : this.ring.snapshot(
          event.occurredAt - PRE_CRASH_LOG_MS,
          event.occurredAt,
          MAX_INCIDENT_LOGS,
          MAX_INCIDENT_LOG_BYTES,
        );
    const incident: IncidentRecord = {
      id: randomUUID(),
      lifeId,
      kind: info.kind,
      severity: info.severity,
      state: 'open',
      fingerprint: eventFingerprint,
      summary: info.summary,
      firstEventAt: event.occurredAt,
      lastEventAt: event.occurredAt,
      occurrenceCount: 1,
      payload: {
        schemaVersion: 1,
        events: [event],
        system: systemSnapshot(this.appVersion, this.electronVersion),
        eventsTruncated: false,
      },
      logs: { schemaVersion: 1, entries: logs.entries, truncated: logs.truncated },
      artifacts: { schemaVersion: 1, items: [], truncated: false },
      createdAt: Date.now(),
      finalizedAt: null,
    };
    this.open.set(incident.id, incident);
    if (!this.persist(incident)) {
      this.open.delete(incident.id);
      return null;
    }
    this.scheduleFinalize(incident);
    return incident;
  }

  public recordEmergency(record: EmergencyMainFatalRecord): IncidentRecord | null {
    const incident = this.record({
      type: 'main_fatal',
      occurredAt: record.occurredAt,
      errorName: record.errorName,
      errorMessage: record.errorMessage,
      stack: record.stack,
      origin: record.origin,
    }, record.lifeId, true);
    if (incident && record.logTail.length > 0) {
      incident.logs.entries = record.logTail.slice(-MAX_INCIDENT_LOGS);
      incident.logs.truncated = record.logTail.length > MAX_INCIDENT_LOGS;
      if (!this.persist(incident)) return null;
    }
    return incident;
  }

  public resolveArtifactTarget(occurredAt: number, preferredLifeId: number): string | null {
    return this.findArtifactTarget(occurredAt, preferredLifeId)?.id ?? null;
  }

  public attachArtifact(incidentId: string, artifact: MinidumpArtifact): string | null {
    const incident = this.open.get(incidentId) ?? this.store.incident(incidentId);
    if (!incident) return null;
    const existing = incident.artifacts.items.find((item) => item.hash === artifact.hash);
    if (existing) return this.persist(incident) ? incident.id : null;
    if (incident.artifacts.items.length >= MAX_ARTIFACTS) {
      incident.artifacts.truncated = true;
      this.persist(incident);
      return null;
    }
    artifact.primary = incident.artifacts.items.length === 0;
    incident.artifacts.items.push(artifact);
    if (this.persist(incident)) return incident.id;
    incident.artifacts.items.pop();
    return null;
  }

  public hasDirectCrashEvidence(lifeId: number): boolean {
    return this.store.listIncidents({ limit: 100 }).some((incident) =>
      incident.lifeId === lifeId && incident.kind !== 'abnormal_termination',
    );
  }

  public hasOpenIncidentNear(occurredAt: number): boolean {
    return [...this.open.values()].some((incident) => Math.abs(incident.firstEventAt - occurredAt) <= CAUSAL_WINDOW_MS);
  }

  public finalizeAll(): void {
    for (const incident of [...this.open.values()]) this.finalizeRecord(incident);
  }

  public finalizeDue(now = Date.now()): void {
    for (const incident of [...this.open.values()]) {
      if (now - incident.firstEventAt >= INCIDENT_WINDOW_MS) this.finalizeRecord(incident);
    }
  }

  private findTarget(lifeId: number, event: CrashEvent, eventFingerprint: string): IncidentRecord | null {
    const sameLife = [...this.open.values()].filter((incident) => incident.lifeId === lifeId);
    const exact = sameLife.find((incident) =>
      incident.fingerprint === eventFingerprint && Math.abs(event.occurredAt - incident.lastEventAt) <= INCIDENT_WINDOW_MS,
    );
    if (exact) return exact;
    return sameLife.find((incident) =>
      Math.abs(event.occurredAt - incident.firstEventAt) <= CAUSAL_WINDOW_MS
      && canJoinCausalWindow(incident, event),
    ) ?? null;
  }

  private findArtifactTarget(occurredAt: number, preferredLifeId: number): IncidentRecord | null {
    const byId = new Map<string, IncidentRecord>();
    for (const incident of this.open.values()) byId.set(incident.id, incident);
    for (const summary of this.store.listIncidents({ limit: 100 })) {
      if (byId.has(summary.incidentId)) continue;
      const incident = this.store.incident(summary.incidentId);
      if (incident) byId.set(incident.id, incident);
    }
    const candidates = [...byId.values()]
      .filter((incident) => incident.lifeId === preferredLifeId)
      .filter((incident) => Math.abs(incident.firstEventAt - occurredAt) <= INCIDENT_WINDOW_MS);
    return candidates.length === 1 ? candidates[0] : null;
  }

  private refreshLogs(incident: IncidentRecord, through: number): void {
    const snapshot = this.ring.snapshot(
      incident.firstEventAt - PRE_CRASH_LOG_MS,
      through,
      MAX_INCIDENT_LOGS,
      MAX_INCIDENT_LOG_BYTES,
    );
    incident.logs.entries = snapshot.entries;
    incident.logs.truncated = snapshot.truncated;
  }

  private scheduleFinalize(incident: IncidentRecord, retryDelayMs?: number): void {
    const existing = this.timers.get(incident.id);
    if (existing) clearTimeout(existing);
    const delay = retryDelayMs ?? Math.max(0, incident.firstEventAt + INCIDENT_WINDOW_MS - Date.now());
    const timer = setTimeout(() => this.finalizeRecord(incident), delay);
    timer.unref();
    this.timers.set(incident.id, timer);
  }

  private finalizeRecord(incident: IncidentRecord): void {
    if (incident.state === 'finalized') return;
    this.refreshLogs(incident, incident.firstEventAt + INCIDENT_WINDOW_MS);
    incident.state = 'finalized';
    incident.finalizedAt = Date.now();
    if (!this.persist(incident)) {
      incident.state = 'open';
      incident.finalizedAt = null;
      this.scheduleFinalize(incident, 1_000);
      return;
    }
    this.open.delete(incident.id);
    const timer = this.timers.get(incident.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(incident.id);
  }

  private persist(incident: IncidentRecord): boolean {
    try {
      this.store.saveIncident(incident);
      return true;
    } catch (error) {
      safeStderr('incident-save', `Incident persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
