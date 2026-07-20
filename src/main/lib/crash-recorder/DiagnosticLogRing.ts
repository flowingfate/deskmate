import type { LogFields, LogLevel } from '@shared/log/types';
import { LEVEL_NUM } from '@shared/log/types';
import type { DiagnosticLogContext, DiagnosticLogEntry } from './types';

const MAX_ENTRIES = 512;
const MAX_BYTES = 512 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024;
const MAX_EMERGENCY_TAIL_BYTES = 32 * 1024;
const MAX_MESSAGE_CHARS = 4 * 1024;
const MAX_STACK_CHARS = 8 * 1024;
const SNAPSHOT_OVERHEAD_BYTES = 128;

interface RingItem {
  entry: DiagnosticLogEntry;
  bytes: number;
}

function bounded(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function text(value: string | number | boolean | null | undefined): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function contextText(fields: LogFields, bindings: Partial<LogFields>, key: string): string | null {
  const value = fields[key] === undefined ? bindings[key] : fields[key];
  if (typeof value === 'string') return bounded(value, key === 'route' ? 1024 : 256);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function contextFrom(fields: LogFields, bindings: Partial<LogFields>): DiagnosticLogContext {
  const context: DiagnosticLogContext = {};
  const profileId = contextText(fields, bindings, 'profileId');
  const agentId = contextText(fields, bindings, 'agentId');
  const sessionId = contextText(fields, bindings, 'sessionId');
  const route = contextText(fields, bindings, 'route');
  if (profileId) context.profileId = profileId;
  if (agentId) context.agentId = agentId;
  if (sessionId) context.sessionId = sessionId;
  if (route) context.route = route;
  return context;
}

function normalizeError(fields: LogFields, bindings: Partial<LogFields>): { message: string | null; stack: string | null } {
  const error = fields.err === undefined ? bindings.err : fields.err;
  if (error instanceof Error) {
    return {
      message: bounded(error.message, MAX_MESSAGE_CHARS),
      stack: error.stack ? bounded(error.stack, MAX_STACK_CHARS) : null,
    };
  }
  if (typeof error === 'string') {
    return { message: bounded(error, MAX_MESSAGE_CHARS), stack: null };
  }
  return { message: null, stack: null };
}

export class DiagnosticLogRing {
  private readonly items: RingItem[] = [];
  private totalBytes = 0;
  private lifeId = 0;
  private droppedThrough = Number.NEGATIVE_INFINITY;
  private emergencyTail = '[]';

  public bindLife(lifeId: number): void {
    this.lifeId = lifeId;
  }

  public append(level: LogLevel, fields: LogFields, bindings: Partial<LogFields>): void {
    const error = normalizeError(fields, bindings);
    const processType = fields.processType === undefined ? bindings.processType : fields.processType;
    const pid = fields.pid === undefined ? bindings.pid : fields.pid;
    const component = fields.mod === undefined ? bindings.mod : fields.mod;
    const traceId = fields.tid === undefined ? bindings.tid : fields.tid;
    const spanId = fields.sid === undefined ? bindings.sid : fields.sid;
    const parentSpanId = fields.psid === undefined ? bindings.psid : fields.psid;
    const windowId = fields.windowId === undefined ? bindings.windowId : fields.windowId;
    const entry: DiagnosticLogEntry = {
      ts: Date.now(),
      level: LEVEL_NUM[level],
      processType: text(processType) ?? 'main',
      pid: typeof pid === 'number' ? pid : process.pid,
      component: bounded(text(component) ?? 'unknown', 512),
      msg: bounded(fields.msg, MAX_MESSAGE_CHARS),
      traceId: text(traceId),
      spanId: text(spanId),
      parentSpanId: text(parentSpanId),
      windowId: typeof windowId === 'number' ? windowId : null,
      lifeId: this.lifeId,
      errorMessage: error.message,
      errorStack: error.stack,
      context: contextFrom(fields, bindings),
    };
    let serialized = JSON.stringify(entry);
    if (Buffer.byteLength(serialized) > MAX_ENTRY_BYTES) {
      entry.errorStack = entry.errorStack ? bounded(entry.errorStack, 2048) : null;
      entry.msg = bounded(entry.msg, 2048);
      serialized = JSON.stringify(entry);
    }
    const bytes = Buffer.byteLength(serialized);
    if (bytes > MAX_ENTRY_BYTES) {
      this.droppedThrough = Math.max(this.droppedThrough, entry.ts);
      return;
    }

    this.items.push({ entry, bytes });
    this.totalBytes += bytes;
    while (this.items.length > MAX_ENTRIES || this.totalBytes > MAX_BYTES) {
      const removed = this.items.shift();
      if (removed) {
        this.droppedThrough = Math.max(this.droppedThrough, removed.entry.ts);
        this.totalBytes -= removed.bytes;
      }
    }
    this.refreshEmergencyTail();
  }

  public snapshot(
    fromInclusive: number,
    toInclusive: number,
    limit = 200,
    maxBytes = MAX_BYTES,
  ): { entries: DiagnosticLogEntry[]; truncated: boolean } {
    const entries: DiagnosticLogEntry[] = [];
    let bytes = SNAPSHOT_OVERHEAD_BYTES;
    let truncated = this.droppedThrough >= fromInclusive && this.droppedThrough <= toInclusive;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (item.entry.ts < fromInclusive || item.entry.ts > toInclusive) continue;
      if (entries.length >= limit || bytes + item.bytes + 1 > maxBytes) {
        truncated = true;
        break;
      }
      entries.unshift(item.entry);
      bytes += item.bytes + 1;
    }
    return { entries, truncated };
  }

  public emergencyTailJson(): string {
    return this.emergencyTail;
  }

  private refreshEmergencyTail(): void {
    const tail: DiagnosticLogEntry[] = [];
    let bytes = 2;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (bytes + item.bytes + 1 > MAX_EMERGENCY_TAIL_BYTES) break;
      tail.unshift(item.entry);
      bytes += item.bytes + 1;
    }
    this.emergencyTail = JSON.stringify(tail);
  }
}

export const diagnosticLogRing = new DiagnosticLogRing();
