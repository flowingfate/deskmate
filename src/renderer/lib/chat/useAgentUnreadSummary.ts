import { useEffect, useMemo, useState } from 'react';

import type { AgentUnreadSummary } from '@shared/types/chatSessionTypes';
import { persistApi, persistEvents } from '@/ipc/persist';

const EMPTY_AGENT_UNREAD_SUMMARY: AgentUnreadSummary = {
  agentId: '',
  userUnreadCount: 0,
  scheduledUnreadCount: 0,
  updatedAt: '',
};

function buildEmptySummary(agentId: string): AgentUnreadSummary {
  return {
    ...EMPTY_AGENT_UNREAD_SUMMARY,
    agentId,
  };
}

export function formatUnreadBadgeCount(count: number): string {
  if (count > 99) {
    return '99+';
  }

  return String(count);
}

function getSummaryUpdatedAtValue(summary: AgentUnreadSummary | undefined): number {
  if (!summary?.updatedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = new Date(summary.updatedAt).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function mergeSummaryByRecency(
  current: AgentUnreadSummary | undefined,
  incoming: AgentUnreadSummary,
): AgentUnreadSummary {
  if (!current) {
    return incoming;
  }

  return getSummaryUpdatedAtValue(incoming) >= getSummaryUpdatedAtValue(current)
    ? incoming
    : current;
}

function mergeSummaryMapByRecency(
  currentMap: Record<string, AgentUnreadSummary>,
  incomingMap: Record<string, AgentUnreadSummary>,
): Record<string, AgentUnreadSummary> {
  const mergedMap = { ...currentMap };

  Object.entries(incomingMap).forEach(([agentId, incomingSummary]) => {
    mergedMap[agentId] = mergeSummaryByRecency(currentMap[agentId], incomingSummary);
  });

  return mergedMap;
}

async function fetchSummary(agentId: string): Promise<AgentUnreadSummary> {
  try {
    const result = await persistApi.getUnreadSummary(agentId);
    if (result.success && result.data) {
      const s = result.data;
      return {
        agentId: s.agentId,
        userUnreadCount: s.userUnreadCount,
        scheduledUnreadCount: s.scheduledUnreadCount,
        updatedAt: s.updatedAt,
      };
    }
  } catch {
    // Fall through to empty
  }
  return buildEmptySummary(agentId);
}

export function useAgentUnreadSummaryMap(
  agentIds: string[],
): Record<string, AgentUnreadSummary> {
  const agentIdsKey = useMemo(
    () => Array.from(new Set(agentIds.filter(Boolean))).sort().join('|'),
    [agentIds],
  );
  const normalizedAgentIds = useMemo(
    () => (agentIdsKey ? agentIdsKey.split('|') : []),
    [agentIdsKey],
  );
  const [summaryMap, setSummaryMap] = useState<Record<string, AgentUnreadSummary>>({});

  useEffect(() => {
    if (normalizedAgentIds.length === 0) {
      setSummaryMap({});
      return;
    }

    let cancelled = false;

    void Promise.all(
      normalizedAgentIds.map(async (agentId) => [agentId, await fetchSummary(agentId)] as const),
    ).then((entries) => {
      if (cancelled) return;
      const fetchedSummaryMap = Object.fromEntries(entries);
      setSummaryMap((prev) => mergeSummaryMapByRecency(prev, fetchedSummaryMap));
    });

    return () => {
      cancelled = true;
    };
  }, [agentIdsKey, normalizedAgentIds]);

  // 订阅 persist 事件：任何对当前可见 agent 的 session/index 改动都触发重拉对应 agent 的 summary。
  // 同一次主进程写入会先 emit `session:updated` 再 emit `session:index:updated`；
  // 用 50ms trailing debounce（按 agentId）合并成单次 IPC，避免重复 getUnreadSummary。
  useEffect(() => {
    if (normalizedAgentIds.length === 0) return;

    const visibleAgentIds = new Set(normalizedAgentIds);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    async function refresh(agentId: string) {
      if (!visibleAgentIds.has(agentId)) return;
      const summary = await fetchSummary(agentId);
      setSummaryMap((prev) => ({
        ...prev,
        [agentId]: mergeSummaryByRecency(prev[agentId], summary),
      }));
    }

    function scheduleRefresh(agentId: string) {
      if (!visibleAgentIds.has(agentId)) return;
      const existing = timers.get(agentId);
      if (existing) clearTimeout(existing);
      timers.set(
        agentId,
        setTimeout(() => {
          timers.delete(agentId);
          void refresh(agentId);
        }, 50),
      );
    }

    const offSession = persistEvents['session:updated']((_e, p) => {
      scheduleRefresh(p.agentId);
    });
    const offIndex = persistEvents['session:index:updated']((_e, p) => {
      scheduleRefresh(p.agentId);
    });
    const offScheduleRun = persistEvents['schedule:run:updated']((_e, p) => {
      scheduleRefresh(p.agentId);
    });

    return () => {
      offSession();
      offIndex();
      offScheduleRun();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [agentIdsKey, normalizedAgentIds]);

  return summaryMap;
}

export function useAgentUnreadSummary(
  agentId: string | null,
): AgentUnreadSummary {
  const summaryMap = useAgentUnreadSummaryMap(agentId ? [agentId] : []);

  if (!agentId) {
    return EMPTY_AGENT_UNREAD_SUMMARY;
  }

  return summaryMap[agentId] || buildEmptySummary(agentId);
}
