// Logs view：完整的 Logs 工作区（toolbar + 表格 + 详情）。
// 提取出来后 App 只负责 view 切换；将来新加 ErrorsView / TracesView 各占一个文件。

import { useEffect, useMemo, useState } from 'react';
import type { LogRow } from '@shared/log/types';
import { DEFAULT_FORM, buildFilterFromForm, type FilterForm } from '../filter';
import { LogsToolbar } from '../components/LogsToolbar';
import { LogTable } from '../components/LogTable';
import { DetailDrawer } from '../components/DetailDrawer';

export function LogsView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const [form, setForm] = useState<FilterForm>(DEFAULT_FORM);
  const [follow, setFollow] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [selected, setSelected] = useState<LogRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const { filter, error: parseError } = useMemo(() => buildFilterFromForm(form), [form]);
  const showError = parseError ?? error;

  // ESC 关详情；Cmd+R 刷新（不靠 menu 也能用）。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && selected) setSelected(null);
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        setRefreshNonce((n) => n + 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <LogsToolbar
        form={form}
        onChange={setForm}
        follow={follow}
        onFollowChange={setFollow}
        onRefresh={() => setRefreshNonce((n) => n + 1)}
        error={showError}
        totalRows={rows.length}
        loading={loading}
      />
      <div className="flex flex-1 overflow-hidden">
        <LogTable
          filter={filter}
          follow={follow}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          onRowsChange={setRows}
          onLoading={setLoading}
          onError={setError}
          refreshNonce={refreshNonce}
        />
        {selected && (
          <DetailDrawer
            row={selected}
            onClose={() => setSelected(null)}
            onPickTraceId={(id) => onOpenTrace(id)}
          />
        )}
      </div>
    </section>
  );
}
