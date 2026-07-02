// 右侧详情抽屉 (light)。
// - 440px 宽；
// - sticky top: level pill + 操作按钮（copy / close）；
// - msg 大字 + 时间相对/绝对；
// - meta grid (Component / Source / Trace / Span)；
// - 错误高亮分块、stack 默认折叠；
// - fields 二列表格 + JSON 值简易着色（字符串橙色、数字蓝色）。

import { useState } from 'react';
import { Copy, ExternalLink, X, Check } from 'lucide-react';
import type { LogRow } from '@shared/log/types';
import { Button } from '@/shadcn/button';
import { cn } from '@/lib/utilities/utils';
import { formatRelative, formatTs, levelName } from '../levels';
import { LevelBadge } from './LevelBadge';

interface Props {
  row: LogRow;
  onClose: () => void;
  // 在 Logs 视图：点 traceId 把它填进过滤器；在 Traces 视图：不传，不展示按钮形态。
  onPickTraceId?: (id: string) => void;
}

export function DetailDrawer({ row, onClose, onPickTraceId }: Props) {
  const [copied, setCopied] = useState(false);
  const fields = parseFields(row.fields);

  function copy() {
    navigator.clipboard
      .writeText(JSON.stringify(toExport(row, fields), null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <aside className="thin-scroll w-[440px] shrink-0 overflow-auto border-l border-vw-divider bg-white">
      {/* sticky header */}
      <div className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-vw-divider bg-white/95 px-5 backdrop-blur">
        <LevelBadge level={row.level} />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={copy}
            className="h-7 gap-1.5 px-2 text-[12px] text-slate-600 hover:text-slate-900"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-600" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy JSON
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="h-7 w-7 text-slate-500 hover:text-slate-900"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-5 py-5">
        <h2 className="text-[14.5px] font-medium leading-snug tracking-tight text-slate-900">
          {row.msg}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <span className="font-mono tabular-nums">{formatTs(row.ts)}</span>
          <Dot />
          <span>{formatRelative(row.ts)}</span>
          <Dot />
          <span className="font-mono">{new Date(row.ts).toISOString()}</span>
        </div>

        {row.err_message && <ErrorBlock message={row.err_message} stack={row.err_stack} />}

        <Section title="Context">
          <dl className="grid grid-cols-[80px_1fr] gap-x-4 gap-y-2.5 text-[12px]">
            <Meta k="Component" v={<span className="font-mono text-slate-800">{row.component}</span>} />
            <Meta
              k="Source"
              v={
                <span className="font-mono text-slate-800">
                  {row.process_type}
                  <span className="text-slate-500"> · pid {row.pid}</span>
                  {row.window_id != null && (
                    <span className="text-slate-500"> · win {row.window_id}</span>
                  )}
                </span>
              }
            />
            {row.trace_id && (
              <Meta
                k="Trace"
                v={
                  onPickTraceId ? (
                    <button
                      onClick={() => onPickTraceId(row.trace_id!)}
                      className="group inline-flex items-center gap-1 font-mono text-slate-800 hover:text-neutral-600"
                      title="Filter by this traceId"
                    >
                      <span className="underline-offset-2 group-hover:underline">{row.trace_id}</span>
                      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ) : (
                    <span className="font-mono text-slate-800">{row.trace_id}</span>
                  )
                }
              />
            )}
            {row.span_id && <Meta k="Span" v={<span className="font-mono text-slate-800">{row.span_id}</span>} />}
            {row.parent_span_id && <Meta k="Parent" v={<span className="font-mono text-slate-800">{row.parent_span_id}</span>} />}
          </dl>
        </Section>

        {fields && Object.keys(fields).length > 0 && (
          <Section title="Fields">
            <FieldsView data={fields} />
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {title}
      </div>
      {children}
    </section>
  );
}

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="pt-[1px] text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}

function Dot() {
  return <span className="text-slate-300">·</span>;
}

function ErrorBlock({ message, stack }: { message: string; stack: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-lg border border-lvl-error/35 bg-lvl-error/5 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lvl-error" />
        <pre className="flex-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-lvl-error">
          {message}
        </pre>
      </div>
      {stack && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-[10px] font-medium uppercase tracking-wider text-slate-500 hover:text-slate-900"
          >
            {open ? 'Hide stack ▴' : 'Show stack ▾'}
          </button>
          {open && (
            <pre className="thin-scroll mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-white p-2.5 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
              {stack}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function FieldsView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  return (
    <div className="overflow-hidden rounded-md border border-vw-divider bg-slate-50/60 font-mono text-[11.5px]">
      {entries.map(([k, v], i) => {
        const isComplex = v !== null && typeof v === 'object';
        return (
          <div
            key={k}
            className={cn(
              'px-3 py-1.5',
              isComplex ? 'flex flex-col gap-1' : 'flex items-start gap-3',
              i !== entries.length - 1 && 'border-b border-slate-200/70',
            )}
          >
            <span
              className={cn(
                'shrink-0 break-all text-slate-500',
                isComplex ? 'block' : 'min-w-0 max-w-[140px] truncate',
              )}
              title={k}
            >
              {k}
            </span>
            <span className="min-w-0 flex-1 break-all text-slate-800">{renderValue(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

function renderValue(v: unknown): React.ReactNode {
  if (v == null) return <span className="text-slate-400">null</span>;
  if (typeof v === 'string')
    return <span className="break-all text-amber-700">"{v}"</span>;
  if (typeof v === 'number' || typeof v === 'boolean')
    return <span className="text-neutral-700">{String(v)}</span>;
  return (
    <pre className="thin-scroll overflow-auto whitespace-pre rounded-md bg-white p-2 font-mono text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}

function parseFields(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const obj: unknown = JSON.parse(s);
    if (obj && typeof obj === 'object' && !Array.isArray(obj))
      return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function toExport(row: LogRow, fields: Record<string, unknown> | null) {
  return {
    id: row.id,
    iso: new Date(row.ts).toISOString(),
    level: levelName(row.level),
    processType: row.process_type,
    pid: row.pid,
    windowId: row.window_id,
    component: row.component,
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    msg: row.msg,
    err: row.err_message
      ? { message: row.err_message, stack: row.err_stack ?? undefined }
      : undefined,
    fields: fields ?? undefined,
  };
}
