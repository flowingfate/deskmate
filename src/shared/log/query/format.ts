import { NUM_LEVEL, type LogRow } from '../types';

export interface FormatOptions {
  pretty?: boolean;
}

function decodeFields(row: LogRow): Record<string, unknown> | null {
  if (!row.fields) return null;
  try {
    return JSON.parse(row.fields);
  } catch {
    return { _rawFields: row.fields };
  }
}

function isoTs(ms: number): string {
  return new Date(ms).toISOString();
}

export function formatJson(rows: LogRow[], opts: FormatOptions = {}): string {
  const out = rows.map((r) => ({
    ts: r.ts,
    iso: isoTs(r.ts),
    level: NUM_LEVEL[r.level] ?? r.level,
    process: r.process_type,
    pid: r.pid,
    component: r.component,
    msg: r.msg,
    traceId: r.trace_id ?? undefined,
    spanId: r.span_id ?? undefined,
    parentSpanId: r.parent_span_id ?? undefined,
    err:
      r.err_message || r.err_stack
        ? { message: r.err_message, stack: r.err_stack }
        : undefined,
    windowId: r.window_id ?? undefined,
    fields: decodeFields(r) ?? undefined,
  }));
  return opts.pretty ? JSON.stringify(out, null, 2) : JSON.stringify(out);
}

export function formatText(rows: LogRow[]): string {
  return rows
    .map((r) => {
      const lvl = (NUM_LEVEL[r.level] ?? String(r.level)).toUpperCase().padEnd(5);
      const fields = decodeFields(r);
      const extra = fields ? ' ' + JSON.stringify(fields) : '';
      const trace = r.trace_id ? ` trace=${r.trace_id}` : '';
      const err = r.err_stack ? `\n  ${r.err_stack.split('\n').join('\n  ')}` : '';
      return `${isoTs(r.ts)} ${lvl} [${r.process_type}/${r.component}]${trace} ${r.msg}${extra}${err}`;
    })
    .join('\n');
}

export function formatMarkdown(rows: LogRow[]): string {
  const head =
    '| time | level | process | component | trace | msg |\n' +
    '|------|-------|---------|-----------|-------|-----|';
  const body = rows
    .map((r) => {
      const lvl = NUM_LEVEL[r.level] ?? String(r.level);
      const trace = r.trace_id ?? '';
      const msg = r.msg.replace(/\|/g, '\\|');
      return `| ${isoTs(r.ts)} | ${lvl} | ${r.process_type} | ${r.component} | ${trace} | ${msg} |`;
    })
    .join('\n');
  return `${head}\n${body}`;
}
