/**
 * useApplyToAgentsState
 *
 * 三个 "Apply X to Agents" dialog（skill / sub-agent / mcp）共享的状态机。
 * 集中维护以下易踩坑的逻辑，避免在三处重复实现：
 *   1. dialog 打开时按当下 agents 快照批量懒读 cold detail（带 cancel）
 *   2. detail 就绪后预选已应用该资源的 agent
 *   3. selection toggle / select-all / count 派生
 *
 * 调用方只需声明：
 *   - `open`: dialog 是否打开
 *   - `resourceKey`: 资源标识；用于在切换资源时重置预选（例如同一 dialog 复用、
 *     依次 apply 多个 skill 的场景）
 *   - `isAlreadyApplied(detail)`: 资源特定的"已应用"判定
 *
 * 死循环背景：把 `useAgents()` 返回的派生数组放进 effect deps 会形成无限循环；
 * `agents.atom.ts#listOrdered` 已按 state 引用做了 memoize 修掉了源头，这个
 * hook 把"批量加载 + 预选 + 选择状态机"集中到一处，防止下一个写类似 dialog
 * 的人重新踩坑（参考 v2.7.x "Maximum update depth exceeded" 复盘）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgents } from '@/states/agents.atom';
import { ensureAgentDetail } from '@/states/agentDetail.atom';
import { persistApi } from '@/ipc/persist';
import type { AgentDetail } from '@shared/persist/types';

/** 列表项统一 shape，三个 dialog 共用。 */
export interface AgentItem {
  agentId: string;
  agentName: string;
  emoji: string;
  avatar?: string;
  alreadyApplied: boolean;
}

interface UseApplyToAgentsStateOptions {
  open: boolean;
  /** 资源标识；变化时会重新预选。例如 skillName / subAgentName / mcpServerNames.join(','). */
  resourceKey: string;
  /** 给定某个 agent 的 cold detail，判断该 agent 是否已经应用了该资源。 */
  isAlreadyApplied: (detail: AgentDetail) => boolean;
}

export interface ApplyToAgentsState {
  /** 完整 cold detail 快照；调用方在 handleApply 时常会用到（取当前 mcpServers / skills 等）。 */
  details: Record<string, AgentDetail | null>;
  /** 全部 agent 的 detail 都已就绪。未就绪时列表显示 loading 占位。 */
  detailsReady: boolean;
  /** 渲染列表用。空 detail 的 agent 仍会显示，但 alreadyApplied 走默认 false。 */
  agentItems: AgentItem[];
  /** 当前勾选的 agentId 集合（含预选的 alreadyApplied 项）。 */
  selectedAgents: Set<string>;
  /** 非 alreadyApplied 的子集；select-all / 计数都基于它。 */
  selectableAgents: AgentItem[];
  /** 全部 selectable 项都已选中。 */
  isAllSelected: boolean;
  /** 真正会被 apply 的项数（已勾选且未 alreadyApplied）。 */
  newlySelectedCount: number;
  handleToggle: (agentId: string, alreadyApplied: boolean) => void;
  handleSelectAll: () => void;
}

export function useApplyToAgentsState(
  opts: UseApplyToAgentsStateOptions,
): ApplyToAgentsState {
  const { open, resourceKey, isAlreadyApplied } = opts;
  const agents = useAgents();

  const [details, setDetails] = useState<Record<string, AgentDetail | null>>({});
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());

  // 批量加载 cold detail。effect 只在 (open, agents) 变化时跑；
  // `agents` 由 `useAgents` 缓存返回稳定引用，所以这里不会反复触发。
  useEffect(() => {
    if (!open) {
      setDetails({});
      setSelectedAgents(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        agents.map(async (a) => {
          void ensureAgentDetail(a.id);
          const r = await persistApi.getAgentDetail(a.id);
          return [a.id, r.success ? (r.data ?? null) : null] as const;
        }),
      );
      if (cancelled) return;
      const next: Record<string, AgentDetail | null> = {};
      for (const [id, d] of entries) next[id] = d;
      setDetails(next);
    })();
    return () => { cancelled = true; };
  }, [open, agents]);

  const detailsReady = open && agents.every((a) => a.id in details);

  const agentItems: AgentItem[] = useMemo(() => {
    if (!detailsReady) return [];
    const items: AgentItem[] = [];
    for (const agent of agents) {
      const detail = details[agent.id];
      items.push({
        agentId: agent.id,
        agentName: agent.name,
        emoji: agent.emoji || '',
        avatar: agent.avatar,
        alreadyApplied: detail ? isAlreadyApplied(detail) : false,
      });
    }
    return items;
    // isAlreadyApplied 由调用方提供，可能每 render 都是新引用，但只在 details/agents/resourceKey
    // 变化时才有意义重算 —— 用 resourceKey 触发资源切换时的重算。
  }, [agents, details, detailsReady, resourceKey]);

  // 预选 alreadyApplied 的项。仅在 (detailsReady 上升沿 + resourceKey) 时触发一次。
  // resourceKey 变化等价于"换了个资源",需要按新资源重新预选；详见 hook 顶部注释。
  useEffect(() => {
    if (!detailsReady) return;
    const initialSelected = new Set<string>();
    for (const item of agentItems) {
      if (item.alreadyApplied) initialSelected.add(item.agentId);
    }
    setSelectedAgents(initialSelected);
    // agentItems 由上面 useMemo 缓存，仅在依赖变化时换引用,可放心入 deps
  }, [detailsReady, resourceKey, agentItems]);

  const handleToggle = useCallback((agentId: string, alreadyApplied: boolean) => {
    if (alreadyApplied) return;
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const selectableAgents = useMemo(
    () => agentItems.filter((item) => !item.alreadyApplied),
    [agentItems],
  );

  const isAllSelected =
    selectableAgents.length > 0
    && selectableAgents.every((item) => selectedAgents.has(item.agentId));

  const handleSelectAll = useCallback(() => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (isAllSelected) {
        for (const item of selectableAgents) next.delete(item.agentId);
      } else {
        for (const item of selectableAgents) next.add(item.agentId);
      }
      return next;
    });
  }, [isAllSelected, selectableAgents]);

  const newlySelectedCount = useMemo(
    () => agentItems.filter(
      (item) => !item.alreadyApplied && selectedAgents.has(item.agentId),
    ).length,
    [agentItems, selectedAgents],
  );

  return {
    details,
    detailsReady,
    agentItems,
    selectedAgents,
    selectableAgents,
    isAllSelected,
    newlySelectedCount,
    handleToggle,
    handleSelectAll,
  };
}
