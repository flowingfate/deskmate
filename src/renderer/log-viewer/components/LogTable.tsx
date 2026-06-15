// 虚拟滚动表格 (light)。
//
// 设计要点：
//   - 用 CSS grid 模板列对齐：[time 88] [level 64] [component 200] [msg 1fr]
//   - sticky 表头一行 26px；列名小字 + uppercase tracking
//   - 行高 24px；行间不画 border，靠 hover/zebra/selected 制造节奏
//   - selected：左 2px 蓝条 + 极淡蓝底；hover：浅灰底
//   - 时间 tabular-nums + mono；component 截断给 tooltip；msg 单行截断
//   - error 行：左侧 2px 红条（轻提示，不抢眼）
//
// 排序：
//   - 默认 desc（最新在顶部）。底层 SQL 已经是 ts DESC，desc 模式下直接用。
//   - asc 模式 reverse 一次，并保持终端 tail 风格（live 追加滚到底）。
//   - desc 模式下 live 总是 prepend，并在用户已离开顶部时补偿 scrollTop，
//     避免视野里的老日志被新行挤下去。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Inbox } from 'lucide-react';
import type { LogQueryFilter, LogRow } from '@shared/log/types';
import { cn } from '@/lib/utilities/utils';
import { viewerApi, viewerEvents } from '../api';
import { formatTs, levelDotClass, levelName, levelTextClass } from '../levels';

const FOLLOW_BATCH_LIMIT = 200;
const ROW_HEIGHT = 24;

// grid 模板：与表头共用。
const COLS = 'grid-cols-[88px_64px_200px_minmax(0,1fr)]';

interface Props {
  filter: LogQueryFilter;
  follow: boolean;
  selectedId: number | null;
  onSelect: (row: LogRow) => void;
  onRowsChange: (rows: LogRow[]) => void;
  onLoading: (loading: boolean) => void;
  onError: (err: string | null) => void;
  refreshNonce: number;
}

type SortDir = 'asc' | 'desc';

export function LogTable({
  filter,
  follow,
  selectedId,
  onSelect,
  onRowsChange,
  onLoading,
  onError,
  refreshNonce,
}: Props) {
  // rows 始终按当前 sortDir 排列：desc 时新→旧，asc 时旧→新。
  const [rows, setRows] = useState<LogRow[]>([]);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const parentRef = useRef<HTMLDivElement>(null);
  // 跟踪当前已加载的最大 id，用于 follow 增量查询；与排序无关。
  const maxSeenIdRef = useRef<number>(0);
  const followRef = useRef(follow);
  const sortDirRef = useRef(sortDir);
  // rows 镜像，避免在 effect 闭包里访问到旧 rows，也避免在 setRows updater
  // 里调用父组件 setState（会触发 "Cannot update a component while rendering" 警告）。
  const rowsRef = useRef<LogRow[]>(rows);
  followRef.current = follow;
  sortDirRef.current = sortDir;
  rowsRef.current = rows;

  useEffect(() => {
    let alive = true;
    onLoading(true);
    onError(null);
    viewerApi
      .query(filter)
      .then((r) => {
        if (!alive) return;
        // SQL 已是 ts DESC, id DESC。desc 模式直接用；asc 模式反转一次。
        const ordered = sortDirRef.current === 'desc' ? r : [...r].reverse();
        setRows(ordered);
        onRowsChange(ordered);
        // 不依赖排序，取整批最大 id 作为 follow 起点。
        maxSeenIdRef.current = r.reduce((m, x) => (x.id > m ? x.id : m), 0);
        requestAnimationFrame(() => {
          const el = parentRef.current;
          if (!el) return;
          el.scrollTo({ top: sortDirRef.current === 'desc' ? 0 : el.scrollHeight });
        });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        onError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) onLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filter, refreshNonce, onLoading, onError, onRowsChange]);

  useEffect(() => {
    if (!follow) return;
    let pending = false;
    const off = viewerEvents.appended(() => {
      if (pending || !followRef.current) return;
      pending = true;
      viewerApi
        .query({ ...filter, sinceId: maxSeenIdRef.current, limit: FOLLOW_BATCH_LIMIT })
        .then((batch) => {
          if (batch.length === 0) return;
          maxSeenIdRef.current = batch.reduce(
            (m, x) => (x.id > m ? x.id : m),
            maxSeenIdRef.current,
          );
          const dir = sortDirRef.current;
          // batch 来自 ts DESC 查询：desc 模式 prepend、asc 模式 reverse 后 append。
          const incoming = dir === 'desc' ? batch : [...batch].reverse();
          const el = parentRef.current;
          // desc + 用户不在顶部：补偿 scrollTop，保持视野中老日志不被挤走。
          // 估算高度 = batch 数 * ROW_HEIGHT；virtualizer 会以同样的 size 渲染。
          const shouldCompensate = dir === 'desc' && !!el && el.scrollTop > 0;
          const compensateBy = shouldCompensate ? batch.length * ROW_HEIGHT : 0;

          const next = dir === 'desc' ? [...incoming, ...rowsRef.current] : [...rowsRef.current, ...incoming];
          setRows(next);
          onRowsChange(next);
          requestAnimationFrame(() => {
            const node = parentRef.current;
            if (!node) return;
            if (dir === 'asc') {
              node.scrollTo({ top: node.scrollHeight });
            } else if (compensateBy > 0) {
              node.scrollTop = node.scrollTop + compensateBy;
            }
          });
        })
        .catch(() => {
          console.warn('[log-viewer] follow query failed');
        })
        .finally(() => {
          pending = false;
        });
    });
    return off;
  }, [follow, filter, onRowsChange]);

  // 切换排序：原地 reverse rows、复位 scroll；不重新查询。
  // 注意：避免在 setSortDir 的 updater 里嵌套 setRows / onRowsChange——
  //   updater 会在 render 阶段执行，里面调其他组件 setState 会触发
  //   "Cannot update a component while rendering a different component"。
  const toggleSort = useCallback(() => {
    const next: SortDir = sortDirRef.current === 'desc' ? 'asc' : 'desc';
    const flipped = [...rowsRef.current].reverse();
    setSortDir(next);
    setRows(flipped);
    onRowsChange(flipped);
    requestAnimationFrame(() => {
      const el = parentRef.current;
      if (!el) return;
      el.scrollTo({ top: next === 'desc' ? 0 : el.scrollHeight });
    });
  }, [onRowsChange]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24,
  });

  const items = virt.getVirtualItems();
  const totalSize = virt.getTotalSize();

  const handleClick = useCallback((row: LogRow) => onSelect(row), [onSelect]);
  const empty = rows.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* sticky 表头 */}
      <div
        className={cn(
          'grid h-[26px] shrink-0 items-center border-b border-vw-divider bg-vw-nav-bg px-4',
          'text-[10px] font-medium uppercase tracking-[0.08em] text-slate-400',
          COLS,
        )}
      >
        <button
          type="button"
          onClick={toggleSort}
          className="flex items-center gap-1 text-left uppercase tracking-[0.08em] text-slate-400 hover:text-slate-700"
          title={sortDir === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
        >
          Time
          {sortDir === 'desc' ? (
            <ArrowDown className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowUp className="h-3 w-3" aria-hidden />
          )}
        </button>
        <div>Level</div>
        <div>Component</div>
        <div>Message</div>
      </div>

      <div
        ref={parentRef}
        className="thin-scroll min-h-0 flex-1 overflow-auto"
        style={{ contain: 'strict' }}
      >
        {empty ? (
          <EmptyState />
        ) : (
          <div className="relative" style={{ height: totalSize }}>
            {items.map((vi) => {
              const r = rows[vi.index];
              return (
                <Row
                  key={r.id}
                  row={r}
                  top={vi.start}
                  selected={r.id === selectedId}
                  zebra={vi.index % 2 === 1}
                  onClick={handleClick}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  row: LogRow;
  top: number;
  selected: boolean;
  zebra: boolean;
  onClick: (r: LogRow) => void;
}

function Row({ row, top, selected, zebra, onClick }: RowProps) {
  const name = levelName(row.level);
  const isError = row.level >= 50;
  return (
    <div
      onClick={() => onClick(row)}
      style={{ top, height: ROW_HEIGHT }}
      className={cn(
        'absolute inset-x-0 grid cursor-pointer items-center px-4 transition-colors hover:bg-slate-100/70',
        selected
          ? 'bg-blue-50 shadow-[inset_2px_0_0] shadow-vw-accent'
          : isError
            ? 'shadow-[inset_2px_0_0] shadow-lvl-error/70'
            : zebra
              ? 'bg-slate-50/100'
              : '',
        COLS,
      )}
    >
      <span className="font-mono text-[11px] tabular-nums text-slate-500">
        {formatTs(row.ts)}
      </span>

      <span className="flex items-center gap-1.5">
        <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', levelDotClass(row.level))} />
        <span
          className={cn(
            'font-mono text-[10px] font-medium uppercase tracking-wider',
            levelTextClass(row.level),
          )}
        >
          {name}
        </span>
      </span>

      <span className="truncate font-mono text-[11.5px] text-slate-700" title={row.component}>
        {row.component}
      </span>

      <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-slate-800">
        <span className="truncate">{row.msg}</span>
        {row.err_message && (
          <span
            className="max-w-[280px] shrink-0 truncate rounded bg-lvl-error/10 px-1.5 py-[1px] font-mono text-[11px] text-lvl-error"
            title={row.err_message}
          >
            {row.err_message}
          </span>
        )}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
        <Inbox className="h-6 w-6 text-slate-400" />
      </div>
      <div className="text-sm font-medium text-slate-700">No matching logs</div>
      <div className="text-xs text-slate-500">
        Try widening the time window or clearing filters
      </div>
    </div>
  );
}
