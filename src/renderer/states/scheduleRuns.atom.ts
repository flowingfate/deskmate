/**
 * scheduleRuns 域 atom（PR-2）。
 *
 * 按 agentId 维度缓存 `JobRunRow[]`（schedule_run 形态；按 startedAt 倒序）。
 * 真值在 main 端 `job_runs` SQLite 表（Step 9 起）；renderer 通过
 * `persist:listAllScheduleRuns` 一次性拉全量；增量靠订阅 schedule 通道重拉。
 *
 * 订阅通道：
 *   - persist:profile:switched      → 清空整张表
 *   - persist:schedule:run:updated  → 全量重 fetch 该 agent（粒度粗，单 agent 通常 <数百 run）
 *   - persist:schedule:removed      → 全量重 fetch（job 被删时连带清掉它的 run）
 *
 * 数据模型说明：
 *  - 字段集与 `RegularSessionIndexEntry` 不同（schedule_run 特有 runStatus / startedAt /
 *    finishedAt / runError），独立 atom 避免 sessionIndex.atom 形态混乱。
 */

import { useEffect } from 'react';
import { unit } from '@/atom/unit';
import { persistApi, persistEvents } from '@/ipc/persist';
import type { JobRunRow } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'scheduleRuns.atom' });

interface AgentSlot {
  runs: JobRunRow[];
  hydrated: boolean;
  loading: Promise<void> | null;
}

interface State {
  byAgentId: Record<string, AgentSlot>;
}

const EMPTY: JobRunRow[] = [];

const { get, change, use } = unit<State>({ byAgentId: {} });

function patchSlot(agentId: string, mut: (slot: AgentSlot) => AgentSlot): void {
  change((s) => {
    const prev = s.byAgentId[agentId] ?? { runs: EMPTY, hydrated: false, loading: null };
    const next = mut(prev);
    if (next === prev) return s;
    return { byAgentId: { ...s.byAgentId, [agentId]: next } };
  });
}

async function fetchRuns(agentId: string): Promise<void> {
  const res = await persistApi.listAllScheduleRuns(agentId);
  if (!res.success) {
    logger.warn({ msg: 'listAllScheduleRuns failed', agentId, error: res.error });
    patchSlot(agentId, (s) => ({ ...s, loading: null }));
    return;
  }
  patchSlot(agentId, () => ({
    runs: res.data ?? [],
    hydrated: true,
    loading: null,
  }));
}

function ensureLoaded(agentId: string): Promise<void> {
  const slot = get().byAgentId[agentId];
  if (slot?.hydrated) return Promise.resolve();
  if (slot?.loading) return slot.loading;
  const p = fetchRuns(agentId);
  patchSlot(agentId, (s) => ({ ...s, loading: p }));
  return p;
}

function reloadAgent(agentId: string): void {
  const slot = get().byAgentId[agentId];
  // 没人订阅这个 agent 就丢掉；等首次 ensureLoaded 时再统一拉
  if (!slot?.hydrated) return;
  patchSlot(agentId, (s) => ({ ...s, loading: fetchRuns(agentId) }));
}

// ────────── 通道订阅 ──────────

persistEvents['profile:switched'](() => {
  change({ byAgentId: {} });
});

persistEvents['schedule:run:updated']((_e, payload) => {
  reloadAgent(payload.agentId);
});

persistEvents['schedule:removed']((_e, payload) => {
  reloadAgent(payload.agentId);
});

// ─────────────── 公共 API ───────────────

/** React Hook：订阅某 agent 的 schedule_run 列表（按 startedAt 倒序）。 */
export function useAgentScheduleRuns(
  agentId: string | null | undefined,
): JobRunRow[] {
  const s = use();
  useEffect(() => {
    if (agentId) void ensureLoaded(agentId);
  }, [agentId]);
  if (!agentId) return EMPTY;
  return s.byAgentId[agentId]?.runs ?? EMPTY;
}

/** 是否已 hydrate（用于 "loading vs empty" 区分）。 */
export function useAgentScheduleRunsHydrated(agentId: string | null | undefined): boolean {
  const s = use();
  if (!agentId) return false;
  return !!s.byAgentId[agentId]?.hydrated;
}
