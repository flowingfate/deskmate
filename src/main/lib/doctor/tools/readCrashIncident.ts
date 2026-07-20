import type { Tool } from '@earendil-works/pi-ai';
import { jsonSchema } from '@main/pi';
import { crashRecorder } from '@main/lib/crash-recorder';
import type { CrashEvent, DiagnosticLogEntry, IncidentKind } from '@main/lib/crash-recorder/types';
import { createRedactor } from '@main/lib/utilities/redact';

export const readCrashIncidentToolDef: Tool = {
  name: 'read_crash_incident',
  description: 'Read one semantic crash incident: event timeline, bounded system snapshot, up to 200 structured logs, and minidump metadata. Never returns dump bytes or absolute paths.',
  parameters: jsonSchema({
    type: 'object',
    properties: {
      incidentId: { type: 'string', description: 'Incident ID returned by list_crash_incidents.' },
    },
    required: ['incidentId'],
  }),
};

export interface ReadCrashIncidentInput {
  incidentId: string;
}

const ABSOLUTE_PATH_PATTERN = /(^|[\s(])(?:\/(?:Applications|Users|Volumes|home|opt|private|tmp|var)\/[^\s'"\])},]+|[A-Z]:\\[^\s'"\])},]+)/gi;
const HOME_PATH_PATTERN = /<(?:HOME|USERPROFILE)>(?:[\\/][^\s'"\])},]+)*/g;

function redactText(value: string, redact: (input: string) => string): string {
  return redact(value)
    .replace(HOME_PATH_PATTERN, '<HOME>')
    .replace(ABSOLUTE_PATH_PATTERN, (_match, prefix: string) => `${prefix}<PATH>`);
}

function redactEvent(event: CrashEvent, redact: (input: string) => string): CrashEvent {
  switch (event.type) {
    case 'main_fatal':
      return {
        ...event,
        errorName: redactText(event.errorName, redact),
        errorMessage: redactText(event.errorMessage, redact),
        stack: redactText(event.stack, redact),
      };
    case 'renderer_gone':
      return { ...event, window: { ...event.window, route: redactText(event.window.route, redact) } };
    case 'child_gone':
      return {
        ...event,
        serviceName: event.serviceName ? redactText(event.serviceName, redact) : null,
        processName: event.processName ? redactText(event.processName, redact) : null,
      };
    case 'run_interrupted':
    case 'shutdown_interrupted':
      return event;
  }
}

function redactLog(entry: DiagnosticLogEntry, redact: (input: string) => string): DiagnosticLogEntry {
  return {
    ...entry,
    msg: redactText(entry.msg, redact),
    errorMessage: entry.errorMessage ? redactText(entry.errorMessage, redact) : null,
    errorStack: entry.errorStack ? redactText(entry.errorStack, redact) : null,
    context: {
      profileId: entry.context.profileId ? redactText(entry.context.profileId, redact) : undefined,
      agentId: entry.context.agentId ? redactText(entry.context.agentId, redact) : undefined,
      sessionId: entry.context.sessionId ? redactText(entry.context.sessionId, redact) : undefined,
      route: entry.context.route ? redactText(entry.context.route, redact) : undefined,
    },
  };
}

function interpretation(kind: IncidentKind, artifactCount: number): string | undefined {
  if (kind === 'abnormal_termination') return 'Abnormal termination is not proof of a native crash.';
  if (artifactCount > 0) return 'Minidump metadata is native/process crash evidence; Doctor cannot inspect binary contents.';
  return undefined;
}

export async function executeReadCrashIncident(args: ReadCrashIncidentInput): Promise<string> {
  if (!args.incidentId) return JSON.stringify({ error: 'incidentId is required.' });
  const incident = crashRecorder.readIncident(args.incidentId);
  if (!incident) return JSON.stringify({ error: 'Incident not found.' });
  const redact = createRedactor();
  return JSON.stringify({
    incidentId: incident.id,
    lifeId: incident.lifeId,
    kind: incident.kind,
    severity: incident.severity,
    state: incident.state,
    summary: incident.summary,
    firstEventAt: incident.firstEventAt,
    lastEventAt: incident.lastEventAt,
    occurrenceCount: incident.occurrenceCount,
    events: incident.payload.events.map((event) => redactEvent(event, redact)),
    system: incident.payload.system,
    logs: incident.logs.entries.slice(-200).map((entry) => redactLog(entry, redact)),
    artifacts: incident.artifacts.items,
    truncation: {
      events: incident.payload.eventsTruncated,
      logs: incident.logs.truncated || incident.logs.entries.length > 200,
      artifacts: incident.artifacts.truncated,
    },
    interpretation: interpretation(incident.kind, incident.artifacts.items.length),
  }, null, 2);
}
