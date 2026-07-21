export const MAX_LIFE_ID = 200_000;
export const MAX_INCIDENT_EVENTS = 64;
export const MAX_INCIDENT_LOGS = 200;
export const MAX_INCIDENT_LOG_BYTES = 512 * 1024;

export type LifecycleState = 'running' | 'closing' | 'clean' | 'interrupted';
export type IncidentKind =
  | 'main_fatal'
  | 'renderer_crash'
  | 'child_process_crash'
  | 'resource_eviction'
  | 'abnormal_termination';
export type IncidentSeverity = 'warning' | 'error' | 'fatal';
export type IncidentState = 'open' | 'finalized';

export type ShutdownReason =
  | 'menu'
  | 'window-all-closed'
  | 'updater-restart'
  | 'os-session-end'
  | 'eval-complete'
  | 'second-instance'
  | 'before-quit'
  | 'test';

export type WindowIdentity =
  | {
      kind: 'profile-main';
      windowId: number;
      webContentsId: number;
      rendererProcessId: number;
      profileId: string;
      route: string;
    }
  | {
      kind: 'auxiliary';
      windowId: number;
      webContentsId: number;
      rendererProcessId: number;
      role: 'screenshot' | 'research' | 'log-viewer';
      route: string;
    };

export type CrashEvent =
  | {
      type: 'main_fatal';
      occurredAt: number;
      errorName: string;
      errorMessage: string;
      stack: string;
      origin: 'uncaughtException' | 'unhandledRejection';
    }
  | {
      type: 'renderer_gone';
      occurredAt: number;
      reason: Electron.RenderProcessGoneDetails['reason'];
      exitCode: number;
      window: WindowIdentity;
    }
  | {
      type: 'child_gone';
      occurredAt: number;
      processType: string;
      reason: string;
      exitCode: number;
      serviceName: string | null;
      processName: string | null;
    }
  | {
      type: 'run_interrupted';
      occurredAt: number;
      previousLifeId: number;
      previousState: 'running';
      previousStartedAt: number;
    }
  | {
      type: 'shutdown_interrupted';
      occurredAt: number;
      previousLifeId: number;
      previousStartedAt: number;
      closingAt: number | null;
      shutdownReason: string | null;
    };

export interface DiagnosticLogContext {
  profileId?: string;
  agentId?: string;
  sessionId?: string;
  route?: string;
}

export interface DiagnosticLogEntry {
  ts: number;
  level: number;
  processType: string;
  pid: number;
  component: string;
  msg: string;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  windowId: number | null;
  lifeId: number;
  errorMessage: string | null;
  errorStack: string | null;
  context: DiagnosticLogContext;
}

export interface SystemSnapshot {
  appVersion: string;
  electronVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  processUptimeMs: number;
  systemUptimeMs: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
}

export interface IncidentPayloadSnapshot {
  schemaVersion: 1;
  events: CrashEvent[];
  system: SystemSnapshot;
  eventsTruncated: boolean;
}

export interface IncidentLogsSnapshot {
  schemaVersion: 1;
  entries: DiagnosticLogEntry[];
  truncated: boolean;
}

export type ArtifactState = 'stored' | 'rejected_quota';

export interface MinidumpArtifact {
  hash: string;
  sizeBytes: number;
  primary: boolean;
  state: ArtifactState;
  discoveredAt: number;
}

export interface IncidentArtifactsSnapshot {
  schemaVersion: 1;
  items: MinidumpArtifact[];
  truncated: boolean;
}

export interface LifecycleRecord {
  lifeId: number;
  startedAt: number;
  state: LifecycleState;
  closingAt: number | null;
  endedAt: number | null;
  shutdownReason: string | null;
  exitCode: number | null;
  appVersion: string;
  electronVersion: string;
  platform: string;
  arch: string;
}

export interface IncidentRecord {
  id: string;
  lifeId: number;
  kind: IncidentKind;
  severity: IncidentSeverity;
  state: IncidentState;
  fingerprint: string;
  summary: string;
  firstEventAt: number;
  lastEventAt: number;
  occurrenceCount: number;
  payload: IncidentPayloadSnapshot;
  logs: IncidentLogsSnapshot;
  artifacts: IncidentArtifactsSnapshot;
  createdAt: number;
  finalizedAt: number | null;
}

export interface IncidentSummary {
  incidentId: string;
  lifeId: number;
  kind: IncidentKind;
  severity: IncidentSeverity;
  summary: string;
  firstEventAt: number;
  lastEventAt: number;
  appVersion: string;
  occurrenceCount: number;
  process: string;
  window: string | null;
  profileId: string | null;
  artifactCount: number;
  artifactBytes: number;
}

export interface IncidentListFilter {
  since?: number;
  limit?: number;
  kind?: IncidentKind;
}

export interface EmergencyMainFatalRecord {
  schemaVersion: 1;
  lifeId: number;
  occurredAt: number;
  type: 'main_fatal';
  errorName: string;
  errorMessage: string;
  stack: string;
  origin: 'uncaughtException' | 'unhandledRejection';
  logTail: DiagnosticLogEntry[];
}

export interface CrashRecorderStatus {
  available: boolean;
  lifeId: number;
  mode: 'dev' | 'prod';
}
