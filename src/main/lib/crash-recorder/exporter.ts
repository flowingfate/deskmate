import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import JSZip from 'jszip';
import { createRedactor } from '@main/lib/utilities/redact';
import type { DiagnosticsStore } from './DiagnosticsStore';
import type { CrashEvent, DiagnosticLogEntry, IncidentRecord } from './types';

const LARGE_EXPORT_BYTES = 100 * 1024 * 1024;

export interface IncidentExportOptions {
  includeMinidumps: boolean;
  confirmedSensitiveMinidumps: boolean;
  confirmedLargeExport: boolean;
}

export type IncidentExportResult =
  | { success: true; filePath: string; fileName: string }
  | { success: false; error: string; requiresLargeExportConfirmation?: boolean };
const IDENTIFIER_PATTERN = /\b([pas])_[0-9A-HJKMNP-TV-Z]{10,}\b/gi;
const URL_PATTERN = /https?:\/\/[^\s"'<>)}\]]+/gi;

function identifierPlaceholder(prefix: string): string {
  if (prefix.toLowerCase() === 'p') return '<PROFILE>';
  if (prefix.toLowerCase() === 'a') return '<AGENT>';
  return '<SESSION>';
}

function templatePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => segment.replace(IDENTIFIER_PATTERN, (_match, prefix: string) => identifierPlaceholder(prefix)))
    .join('/');
}

function sanitizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}${templatePathname(parsed.pathname)}`;
  } catch {
    return raw;
  }
}

function createExportRedactor(): (value: string) => string {
  const redact = createRedactor();
  return (value) => redact(value)
    .replace(URL_PATTERN, (url) => sanitizeUrl(url))
    .replace(IDENTIFIER_PATTERN, (_match, prefix: string) => identifierPlaceholder(prefix));
}

function redactRoute(route: string, redact: (value: string) => string): string {
  const redacted = redact(route);
  if (/^https?:\/\//i.test(redacted)) return sanitizeUrl(redacted);
  return templatePathname(redacted.split(/[?#]/, 1)[0]);
}

function redactEvent(event: CrashEvent, redact: (value: string) => string): CrashEvent {
  switch (event.type) {
    case 'main_fatal':
      return { ...event, errorMessage: redact(event.errorMessage), stack: redact(event.stack) };
    case 'renderer_gone':
      if (event.window.kind === 'profile-main') {
        return {
          ...event,
          window: { ...event.window, profileId: '<PROFILE>', route: redactRoute(event.window.route, redact) },
        };
      }
      return { ...event, window: { ...event.window, route: redactRoute(event.window.route, redact) } };
    case 'child_gone':
      return {
        ...event,
        serviceName: event.serviceName ? redact(event.serviceName) : null,
        processName: event.processName ? redact(event.processName) : null,
      };
    case 'run_interrupted':
    case 'shutdown_interrupted':
      return event;
  }
}

function redactLog(entry: DiagnosticLogEntry, redact: (value: string) => string): DiagnosticLogEntry {
  return {
    ...entry,
    msg: redact(entry.msg),
    errorMessage: entry.errorMessage ? redact(entry.errorMessage) : null,
    errorStack: entry.errorStack ? redact(entry.errorStack) : null,
    context: {
      profileId: entry.context.profileId ? '<PROFILE>' : undefined,
      agentId: entry.context.agentId ? '<AGENT>' : undefined,
      sessionId: entry.context.sessionId ? '<SESSION>' : undefined,
      route: entry.context.route ? redactRoute(entry.context.route, redact) : undefined,
    },
  };
}

function sanitizedIncident(incident: IncidentRecord): IncidentRecord {
  const redact = createExportRedactor();
  return {
    ...incident,
    payload: {
      ...incident.payload,
      events: incident.payload.events.map((event) => redactEvent(event, redact)),
    },
    logs: {
      ...incident.logs,
      entries: incident.logs.entries.map((entry) => redactLog(entry, redact)),
    },
  };
}

function outputPath(incidentId: string): { filePath: string; fileName: string } {
  const downloads = app.getPath('downloads');
  const stem = `incident-${incidentId}`;
  let fileName = `${stem}.zip`;
  let filePath = path.join(downloads, fileName);
  let suffix = 1;
  while (fs.existsSync(filePath)) {
    fileName = `${stem}-${suffix}.zip`;
    filePath = path.join(downloads, fileName);
    suffix += 1;
  }
  return { filePath, fileName };
}

export async function exportCrashIncident(
  store: DiagnosticsStore,
  artifactDirectory: string,
  incidentId: string,
  options: IncidentExportOptions,
): Promise<IncidentExportResult> {
  const incident = store.incident(incidentId);
  if (!incident) return { success: false, error: 'Incident not found.' };
  if (options.includeMinidumps && !options.confirmedSensitiveMinidumps) {
    return { success: false, error: 'Minidump export requires explicit sensitive-data confirmation.' };
  }

  const artifactFiles = options.includeMinidumps
    ? incident.artifacts.items
        .filter((artifact) => artifact.state === 'stored')
        .map((artifact) => ({
          artifact,
          filePath: path.join(artifactDirectory, `${artifact.hash}.dmp`),
        }))
        .filter((item) => fs.existsSync(item.filePath))
    : [];
  const estimatedBytes = Buffer.byteLength(JSON.stringify(incident))
    + artifactFiles.reduce((sum, item) => sum + item.artifact.sizeBytes, 0);
  if (estimatedBytes > LARGE_EXPORT_BYTES && !options.confirmedLargeExport) {
    return {
      success: false,
      error: 'Export exceeds 100 MiB and requires a second confirmation.',
      requiresLargeExportConfirmation: true,
    };
  }

  const sanitized = sanitizedIncident(incident);
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({
    schemaVersion: 1,
    incidentId: sanitized.id,
    exportedAt: new Date().toISOString(),
    includesMinidumps: artifactFiles.length > 0,
  }, null, 2));
  zip.file('events.json', JSON.stringify(sanitized.payload.events, null, 2));
  zip.file('logs.jsonl', sanitized.logs.entries.map((entry) => JSON.stringify(entry)).join('\n'));
  zip.file('system.json', JSON.stringify(sanitized.payload.system, null, 2));
  zip.file('artifacts.json', JSON.stringify(sanitized.artifacts, null, 2));
  for (const item of artifactFiles) {
    zip.file(`artifacts/${item.artifact.hash}.dmp`, fs.createReadStream(item.filePath));
  }

  const output = outputPath(incidentId);
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await fs.promises.writeFile(output.filePath, buffer, { mode: 0o600 });
  return { success: true, ...output };
}
