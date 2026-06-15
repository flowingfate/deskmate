/**
 * sessionIndex 域 atom（D3）。
 *
 * 按 agentId 维度缓存 `RegularSessionIndexEntry[]`（仅 regular，schedule_run 走独立通道）。
 * 真值在 main 端 `regular_sessions` SQLite 表；renderer 通过 persist IPC 同步。
 *
 * 订阅通道：
 *   - persist:profile:switched      → 清空整张表
 *   - persist:session:index:updated → 单条 op（'upsert' / 'remove'）增量合并（Step 9 起，
 *     从老模型"整月 entries 数组"改为"单条 op + entry/id"）
 *   - persist:session:updated       → upsert 单条 entry（kind / star / readStatus / title 等可能变化）
 *
 * 数据模型说明：
 *  - 每个 agent 一次性把所有 entries 拉回来（listAllSessions），不分页；entry 字段是 lightweight
 *    （id/title/createdAt/updatedAt/star/readStatus/kind），单 agent 通常几十到几百条。
 *  - 仅缓存 regular。schedule_run 走 `scheduleRuns.atom`。
 */

import { useEffect } from 'react';
import { unit } from '@/atom/unit';
import { persistApi, persistEvents } from '@/ipc/persist';
import type { RegularSessionIndexEntry } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'sessionIndex.atom' });

interface AgentSlot {
  entries: RegularSessionIndexEntry[];   // 按 updatedAt 倒序
  hydrated: boolean;
  loading: Promise<void> | null;
}

interface State {
  byAgentId: Record<string, AgentSlot>;
}

const EMPTY: RegularSessionIndexEntry[] = [];

const { get, change, listen, use } = unit<State>({ byAgentId: {} });


function sortDesc(arr: RegularSessionIndexEntry[]): RegularSessionIndexEntry[] {
  return [...arr].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
  );
}

function patchSlot(agentId: string, mut: (slot: AgentSlot) => AgentSlot): void {
  change((s) => {
    const prev = s.byAgentId[agentId] ?? { entries: EMPTY, hydrated: false, loading: null };
    const next = mut(prev);
    if (next === prev) return s;
    return { byAgentId: { ...s.byAgentId, [agentId]: next } };
  });
}

/**
 * 确保某 agent 的 sessions 已加载；幂等。并发调用共享同一个 promise，避免重复 IPC。
 * 失败仅打日志，slot.hydrated 保持 false 让下次 use 再试。
 */
function ensureLoaded(agentId: string): Promise<void> {
  const slot = get().byAgentId[agentId];
  if (slot?.hydrated) return Promise.resolve();
  if (slot?.loading) return slot.loading;

  const p = (async () => {
    const res = await persistApi.listAllSessions(agentId);
    if (!res.success) {
      logger.warn({ msg: 'listAllSessions failed', agentId, error: res.error });
      patchSlot(agentId, (s) => ({ ...s, loading: null }));
      return;
    }
    const entries = res.data ?? [];
    patchSlot(agentId, () => ({
      entries: sortDesc(entries),
      hydrated: true,
      loading: null,
    }));
  })();

  patchSlot(agentId, (s) => ({ ...s, loading: p }));
  return p;
}

// ────────── 通道订阅 ──────────

persistEvents['profile:switched'](() => {
  change({ byAgentId: {} });
});

persistEvents['session:index:updated']((_e, payload) => {
  const slot = get().byAgentId[payload.agentId];
  // 没人订阅这个 agent 就丢掉；等首次 ensureLoaded 时再统一拉
  if (!slot?.hydrated) return;
  if (payload.op === 'remove') {
    const next = slot.entries.filter((e) => e.id !== payload.id);
    if (next.length === slot.entries.length) return;
    patchSlot(payload.agentId, (s) => ({ ...s, entries: next }));
    return;
  }
  // op === 'upsert'
  const incoming = payload.entry;
  const idx = slot.entries.findIndex((e) => e.id === incoming.id);
  const arr = idx >= 0
    ? [...slot.entries.slice(0, idx), incoming, ...slot.entries.slice(idx + 1)]
    : [incoming, ...slot.entries];
  patchSlot(payload.agentId, (s) => ({ ...s, entries: sortDesc(arr) }));
});

persistEvents['session:updated']((_e, payload) => {
  const slot = get().byAgentId[payload.agentId];
  if (!slot?.hydrated) return;
  if (payload.data.kind !== 'regular') return;
  const d = payload.data;
  const next: RegularSessionIndexEntry = {
    kind: 'regular',
    id: d.id,
    title: d.title,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    readStatus: d.readStatus,
    star: d.star,
  };
  const idx = slot.entries.findIndex((e) => e.id === d.id);
  const arr = idx >= 0
    ? [...slot.entries.slice(0, idx), next, ...slot.entries.slice(idx + 1)]
    : [next, ...slot.entries];
  patchSlot(payload.agentId, (s) => ({ ...s, entries: sortDesc(arr) }));
});

// ─────────────── 公共 API ───────────────

/**
 * 同步取某 agent 的 regular session 列表（按 updatedAt 倒序）。
 * 首次访问会触发后台 hydrate；本次调用返回空数组，待数据到达后通过订阅刷新。
 */
export function getAgentSessions(agentId: string | null | undefined): RegularSessionIndexEntry[] {
  if (!agentId) return EMPTY;
  void ensureLoaded(agentId);
  return get().byAgentId[agentId]?.entries ?? EMPTY;
}

/** React Hook：订阅某 agent 的 regular session 列表。 */
export function useAgentSessions(agentId: string | null | undefined): RegularSessionIndexEntry[] {
  const s = use();
  useEffect(() => {
    if (agentId) void ensureLoaded(agentId);
  }, [agentId]);
  if (!agentId) return EMPTY;
  return s.byAgentId[agentId]?.entries ?? EMPTY;
}

/** 是否已 hydrate（用于区分"empty 因为还没拉"与"empty 因为真没有"）。 */
export function useAgentSessionsHydrated(agentId: string | null | undefined): boolean {
  const s = use();
  if (!agentId) return false;
  return !!s.byAgentId[agentId]?.hydrated;
}

/** 取某 agent 最新一条 session（无则 null）。 */
export function getLatestSession(agentId: string | null | undefined): RegularSessionIndexEntry | null {
  const list = getAgentSessions(agentId);
  return list[0] ?? null;
}

/**
 * 显式触发某 agent 的 hydrate 并 await 完成。返回最新 entries。
 * 用于 SidebarTop 等"想知道 latest 但 atom 可能还没拉过"的调用方。
 */
export async function ensureAgentSessionsLoaded(
  agentId: string,
): Promise<RegularSessionIndexEntry[]> {
  await ensureLoaded(agentId);
  return get().byAgentId[agentId]?.entries ?? EMPTY;
}

/** 取某 agent 某 session entry。 */
export function getSessionEntry(
  agentId: string | null | undefined,
  sessionId: string | null | undefined,
): RegularSessionIndexEntry | null {
  if (!agentId || !sessionId) return null;
  return getAgentSessions(agentId).find((e) => e.id === sessionId) ?? null;
}

/** 非 React 订阅整张 sessionIndex 表（粒度粗，用于全局刷新）。 */
export function listenSessionIndex(cb: (state: State) => void): VoidFunction {
  return listen(cb);
}
