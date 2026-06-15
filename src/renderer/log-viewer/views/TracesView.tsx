// Traces view：按 traceId 拉一组 log，重建 span 森林，渲染"左 tree + 右时间条带"。
//
// 设计：
//   - 顶部 toolbar：traceId 输入 + Load + 概览（行数 / span 数 / 跨度 / 深度 / 孤儿数）。
//   - 主体：每个 span 一行 (h-7=28px)，分两栏：
//       · 左 SPAN_PANEL_WIDTH：tree-table（缩进 depth × 12px，▾/▸ + mod + sid · dur）
//       · 右剩余宽度：SVG 时间条带，按 (startTs - minTs) / span 算 x；条带宽 = dur 比例
//         · hasError 红色描边；无 dur (孤儿 span) 退化成圆点
//         · 选中行：左侧 2px 蓝边 + 极淡蓝底
//   - hover 一行：右侧 SVG 画一条全宽虚线游标
//   - 点击行：DetailDrawer 显示第一条 row（"始"），抽屉内列出 span 内全部 rows 供选切换
//   - 顶部 axis：4 段 tick，第 0 个显示绝对时间，其它显示 "+10ms" 偏移
//   - 孤儿（无 sid 的 log）：底部分一节单独列出，按 ts 时间轴排
//
// 为什么不是 lane-per-process_type：trace 设计里同 trace 99% 都在 main，多通道会浪费纵向空间，
// 且无法表达 span 的父子嵌套（chat.turn → chat.tool 这种"形状"）。span-tree 是正确的形状。
//
// 性能：span 数典型 < 30，极端工具风暴 < 200，直接渲染不上虚拟化。

import { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Search, ChevronRight } from 'lucide-react';
import type { LogRow } from '@shared/log/types';
import { Button } from '@/shadcn/button';
import { Input } from '@/shadcn/input';
import { cn } from '@/lib/utilities/utils';
import { viewerApi } from '../api';
import { formatTs, levelCssVar, levelTextClass } from '../levels';
import { DetailDrawer } from '../components/DetailDrawer';
import { buildSpanForest, type SpanForest, type SpanNode } from '../spanTree';

const ROW_HEIGHT = 28;
const SPAN_PANEL_WIDTH = 320;
const TIMELINE_PADDING_X = 16;
const AXIS_HEIGHT = 28;
const INDENT_PER_DEPTH = 12;

interface Props {
  initialTraceId: string | null;
  onConsumeInitial: () => void;
}

interface Loaded {
  traceId: string;
  rows: LogRow[];
  forest: SpanForest;
}

export function TracesView({ initialTraceId, onConsumeInitial }: Props) {
  const [input, setInput] = useState(initialTraceId ?? '');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LogRow | null>(null);

  // 来自 LogsView/DetailDrawer 的入口：自动加载一次后清空。
  useEffect(() => {
    if (!initialTraceId) return;
    setInput(initialTraceId);
    void runLoad(initialTraceId);
    onConsumeInitial();
    // 仅响应 initialTraceId 变化
  }, [initialTraceId]);

  async function runLoad(id: string) {
    const trimmed = id.trim();
    if (!trimmed) {
      setError('traceId is empty');
      return;
    }
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const rows = await viewerApi.query({ traceId: trimmed, limit: 5000 });
      const forest = buildSpanForest(rows);
      setLoaded({ traceId: trimmed, rows, forest });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <Toolbar
        input={input}
        onInputChange={setInput}
        onSubmit={() => void runLoad(input)}
        loading={loading}
        error={error}
        loaded={loaded}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="thin-scroll flex-1 overflow-auto">
          {loaded == null ? (
            <EmptyState />
          ) : loaded.rows.length === 0 ? (
            <NoMatchState traceId={loaded.traceId} />
          ) : (
            <SpanTimeline
              forest={loaded.forest}
              selectedRow={selected}
              onPick={setSelected}
            />
          )}
        </div>
        {selected && (
          <DetailDrawer row={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </section>
  );
}

interface ToolbarProps {
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
  loaded: Loaded | null;
}

function Toolbar({ input, onInputChange, onSubmit, loading, error, loaded }: ToolbarProps) {
  const stats = useMemo(() => {
    if (!loaded) return null;
    const { forest, rows } = loaded;
    const span = forest.maxTs - forest.minTs;
    const depth = forest.flat.reduce((m, n) => Math.max(m, n.depth), 0);
    return {
      rows: rows.length,
      spans: forest.flat.length,
      orphans: forest.orphans.length,
      depth,
      span,
    };
  }, [loaded]);

  return (
    <header className="flex flex-col border-b border-slate-200">
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-slate-500" />
          <h1 className="text-[14px] font-semibold tracking-tight text-slate-900">Traces</h1>
          {stats && (
            <span className="ml-2 text-[11px] text-slate-500">
              {stats.spans} {plural('span', stats.spans)} · {stats.rows} {plural('event', stats.rows)} · depth {stats.depth} · {formatDuration(stats.span)}
              {stats.orphans > 0 && <span className="text-amber-600"> · {stats.orphans} orphan {plural('row', stats.orphans)}</span>}
            </span>
          )}
        </div>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
      <div className="flex h-[38px] items-center gap-2 bg-slate-50/60 px-4">
        <Search className="h-3.5 w-3.5 text-slate-400" />
        <Input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          placeholder="traceId"
          className="h-7 flex-1 max-w-[420px] font-mono text-[12px]"
        />
        <Button size="sm" onClick={onSubmit} disabled={loading} className="h-7 px-3 text-[12px]">
          {loading ? 'Loading…' : 'Load'}
        </Button>
      </div>
    </header>
  );
}

interface SpanTimelineProps {
  forest: SpanForest;
  selectedRow: LogRow | null;
  onPick: (row: LogRow) => void;
}

function SpanTimeline({ forest, selectedRow, onPick }: SpanTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverY, setHoverY] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const { flat, orphans, minTs, maxTs } = forest;
  // 防 / 0：trace 内所有 row 同 ts 时 span = 0，所有条带退化成点也合理
  const span = Math.max(1, maxTs - minTs);
  const timelineX = SPAN_PANEL_WIDTH;
  const innerWidth = Math.max(0, width - timelineX - TIMELINE_PADDING_X);
  const spanRowsHeight = flat.length * ROW_HEIGHT;
  const orphanHeader = orphans.length > 0 ? 32 : 0;
  const orphanRowsHeight = orphans.length * ROW_HEIGHT;
  const totalHeight = AXIS_HEIGHT + spanRowsHeight + orphanHeader + orphanRowsHeight + 8;

  function xOf(ts: number): number {
    return timelineX + ((ts - minTs) / span) * innerWidth;
  }

  const ticks = useMemo(() => {
    const out: Array<{ x: number; ts: number; rel: number }> = [];
    for (let i = 0; i <= 4; i++) {
      const rel = (span * i) / 4;
      out.push({ x: timelineX + (i * innerWidth) / 4, ts: minTs + rel, rel });
    }
    return out;
  }, [span, innerWidth, timelineX, minTs]);

  // selected sid：高亮命中所选 row 所属的 span。
  const selectedSid = selectedRow?.span_id ?? null;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {/* 顶部 axis：用 absolute 定位与下面的 SVG 共享坐标系 */}
      <svg width={width} height={AXIS_HEIGHT} className="block">
        {/* 通道分隔（左侧 tree 与右侧 timeline） */}
        <line x1={timelineX - 1} y1={0} x2={timelineX - 1} y2={AXIS_HEIGHT} stroke="#e2e8f0" />
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={AXIS_HEIGHT - 8} x2={t.x} y2={AXIS_HEIGHT} stroke="#cbd5e1" />
            <text
              x={t.x}
              y={AXIS_HEIGHT - 12}
              fontSize={10}
              fontFamily="ui-monospace, monospace"
              fill="#64748b"
              textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
            >
              {i === 0 ? formatTs(t.ts) : `+${formatDuration(t.rel)}`}
            </text>
          </g>
        ))}
        <text x={12} y={AXIS_HEIGHT - 12} fontSize={10} fontFamily="ui-monospace, monospace" fill="#475569" fontWeight={500}>
          Span tree
        </text>
      </svg>

      {/* 主体行 + 时间条带 */}
      <div className="relative" style={{ height: totalHeight - AXIS_HEIGHT }}>
        {/* 行底 SVG：画时间条带、孤儿点、hover 游标 */}
        <svg
          width={width}
          height={totalHeight - AXIS_HEIGHT}
          className="pointer-events-none absolute inset-0"
        >
          {/* 通道分隔线 */}
          <line
            x1={timelineX - 1}
            y1={0}
            x2={timelineX - 1}
            y2={totalHeight - AXIS_HEIGHT}
            stroke="#e2e8f0"
          />
          {/* hover 全宽虚线 */}
          {hoverY != null && (
            <line
              x1={timelineX}
              y1={hoverY}
              x2={width - TIMELINE_PADDING_X}
              y2={hoverY}
              stroke="#94a3b8"
              strokeDasharray="3 4"
              strokeWidth={1}
            />
          )}
          {/* span 条带 */}
          {flat.map((node, i) => {
            const y = i * ROW_HEIGHT + ROW_HEIGHT / 2;
            const x1 = xOf(node.startTs);
            const x2 = xOf(node.endTs);
            const color = levelCssVar(node.maxLevel);
            const w = Math.max(2, x2 - x1);
            if (!node.hasDur && x2 - x1 < 2) {
              // 没拿到 dur 的孤儿 span（始或终缺失）：画一个圆点表示"瞬时事件"
              return (
                <circle
                  key={node.sid}
                  cx={x1}
                  cy={y}
                  r={3.5}
                  fill={color}
                  fillOpacity={0.7}
                  stroke="white"
                />
              );
            }
            return (
              <g key={node.sid}>
                <rect
                  x={x1}
                  y={y - 6}
                  width={w}
                  height={12}
                  rx={3}
                  fill={color}
                  fillOpacity={node.hasError ? 0.7 : 0.55}
                  stroke={node.hasError ? '#dc2626' : 'transparent'}
                  strokeWidth={node.hasError ? 1.5 : 0}
                />
                {/* 条带太宽时，把 dur 写在条带内 */}
                {w > 60 && (
                  <text
                    x={x1 + w / 2}
                    y={y + 3}
                    fontSize={10}
                    fontFamily="ui-monospace, monospace"
                    fill="white"
                    textAnchor="middle"
                    style={{ pointerEvents: 'none' }}
                  >
                    {formatDuration(node.endTs - node.startTs)}
                  </text>
                )}
              </g>
            );
          })}
          {/* 孤儿 row 时间点 */}
          {orphans.map((o, i) => {
            const y = spanRowsHeight + orphanHeader + i * ROW_HEIGHT + ROW_HEIGHT / 2;
            const x = xOf(o.row.ts);
            return (
              <circle
                key={`orphan-${o.row.id}`}
                cx={x}
                cy={y}
                r={3}
                fill={levelCssVar(o.row.level)}
                fillOpacity={0.6}
                stroke="white"
              />
            );
          })}
        </svg>

        {/* 左侧 tree 行 + 右侧透明 hover 区 */}
        {flat.map((node, i) => (
          <SpanRow
            key={node.sid}
            node={node}
            top={i * ROW_HEIGHT}
            selected={node.sid === selectedSid}
            onHover={(y) => setHoverY(y)}
            onLeave={() => setHoverY(null)}
            onClick={() => onPick(node.rows[0])}
          />
        ))}

        {orphans.length > 0 && (
          <div
            className="absolute left-0 right-0 flex items-center gap-2 border-y border-slate-200 bg-slate-50/60 px-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-600"
            style={{ top: spanRowsHeight, height: orphanHeader }}
          >
            Orphan rows (no span_id)
          </div>
        )}

        {orphans.map((o, i) => (
          <OrphanRowView
            key={`orphan-row-${o.row.id}`}
            row={o.row}
            top={spanRowsHeight + orphanHeader + i * ROW_HEIGHT}
            selected={o.row.id === selectedRow?.id}
            onClick={() => onPick(o.row)}
          />
        ))}
      </div>
    </div>
  );
}

interface SpanRowProps {
  node: SpanNode;
  top: number;
  selected: boolean;
  onHover: (y: number) => void;
  onLeave: () => void;
  onClick: () => void;
}

function SpanRow({ node, top, selected, onHover, onLeave, onClick }: SpanRowProps) {
  const indent = node.depth * INDENT_PER_DEPTH;
  const showChevron = node.children.length > 0;
  const dur = node.endTs - node.startTs;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onHover(top + ROW_HEIGHT / 2)}
      onMouseLeave={onLeave}
      style={{ top, height: ROW_HEIGHT, width: SPAN_PANEL_WIDTH }}
      className={cn(
        'absolute left-0 flex cursor-pointer items-center gap-1 px-2 transition-colors',
        selected
          ? 'bg-blue-50 shadow-[inset_2px_0_0] shadow-vw-accent'
          : 'hover:bg-slate-50',
      )}
    >
      <span style={{ width: indent }} aria-hidden />
      {showChevron ? (
        <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
      ) : (
        <span className="h-3 w-3 shrink-0" aria-hidden />
      )}
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: levelCssVar(node.maxLevel) }}
      />
      <span className={cn('truncate font-mono text-[12px]', node.hasError ? 'text-red-600' : 'text-slate-800')}>
        {node.mod ?? '(mixed)'}
      </span>
      <span className="ml-auto flex items-center gap-2 pl-2 font-mono text-[10px] text-slate-400">
        <span title={`sid ${node.sid}`}>{node.sid}</span>
        {node.hasDur && <span className="tabular-nums">{formatDuration(dur)}</span>}
        {!node.hasDur && <span className="text-amber-500" title="span has no end / dur record">∅</span>}
      </span>
    </div>
  );
}

interface OrphanRowProps {
  row: LogRow;
  top: number;
  selected: boolean;
  onClick: () => void;
}

function OrphanRowView({ row, top, selected, onClick }: OrphanRowProps) {
  return (
    <div
      onClick={onClick}
      style={{ top, height: ROW_HEIGHT, width: SPAN_PANEL_WIDTH }}
      className={cn(
        'absolute left-0 flex cursor-pointer items-center gap-2 px-3 transition-colors',
        selected
          ? 'bg-blue-50 shadow-[inset_2px_0_0] shadow-vw-accent'
          : 'hover:bg-slate-50',
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: levelCssVar(row.level) }}
      />
      <span className={cn('truncate font-mono text-[12px]', levelTextClass(row.level))} title={row.component}>
        {row.component}
      </span>
      <span className="truncate text-[11px] text-slate-500">{row.msg}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-500">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
        <GitBranch className="h-6 w-6 text-slate-400" />
      </div>
      <div className="text-sm font-medium text-slate-700">Enter a traceId to load a span tree</div>
      <div className="max-w-[380px] text-xs text-slate-500">
        Found in the Logs view: click any traceId in the detail drawer to jump here. Traces are reconstructed from span_id / parent_span_id pairs.
      </div>
    </div>
  );
}

function NoMatchState({ traceId }: { traceId: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-500">
      <div className="text-sm font-medium text-slate-700">No logs for trace</div>
      <div className="font-mono text-xs text-slate-500">{traceId}</div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${ms.toFixed(1)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(2)}m`;
}

function plural(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}
