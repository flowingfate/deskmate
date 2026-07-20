import type { Tool } from '@earendil-works/pi-ai';
import { jsonSchema } from '@main/pi';
import { crashRecorder } from '@main/lib/crash-recorder';
import type { IncidentKind } from '@main/lib/crash-recorder';

export const listCrashIncidentsToolDef: Tool = {
  name: 'list_crash_incidents',
  description: 'List semantic crash incidents with bounded metadata. Call once during collection, then read only an incident whose time and symptoms are relevant.',
  parameters: jsonSchema({
    type: 'object',
    properties: {
      since: { type: 'string', description: 'Optional ISO-8601 lower time bound.' },
      limit: { type: 'number', description: 'Maximum incidents, 1-100. Defaults to 20.' },
      kind: {
        type: 'string',
        enum: ['main_fatal', 'renderer_crash', 'child_process_crash', 'resource_eviction', 'abnormal_termination'],
      },
    },
    required: [],
  }),
};

export interface ListCrashIncidentsInput {
  since?: string;
  limit?: number;
  kind?: IncidentKind;
}

export async function executeListCrashIncidents(args: ListCrashIncidentsInput): Promise<string> {
  const since = args.since ? Date.parse(args.since) : undefined;
  if (args.since && !Number.isFinite(since)) {
    return JSON.stringify({ error: 'since must be a valid ISO-8601 timestamp.' });
  }
  const incidents = crashRecorder.listIncidents({
    since,
    limit: args.limit,
    kind: args.kind,
  });
  return JSON.stringify({
    recorder: crashRecorder.status(),
    incidents,
    note: incidents.length === 0 ? 'No crash incidents found in this scope.' : undefined,
  }, null, 2);
}
