/**
 * agentDetail 域 atom（lazy cold-fields cache）。
 *
 * 数据形状：`AgentDetail`（AGENT.md cold 字段集合：systemPrompt + thinkingLevel
 *   + mcpServers + skills + delegates + zero(空态预设提示词)）。
 *
 * 拉取策略：按 agentId 按需懒读（`useAgentDetail` 命中 cache 同步返；缺 cache 异步
 *   fetch + cache + re-render），并发同 id 合并为同一 Promise（inflight 模式）。
 *
 * 订阅通道：
 *   - persist:profile:switched → 清空整张表
 *   - persist:agent:updated    → 用 payload.detail 直接刷 cache（main 端写盘后下推
 *                                avoid 一次再 invoke 的 round-trip）
 *   - persist:agent:removed    → 删 entry
 *
 * **不在这里**：列表展示字段（name / version / emoji / avatar / model /
 *   createdAt / updatedAt）—— 那些是 hot list 字段，在 `agents.atom`
 *   （AgentRecord）。两层 atom 互补，按需 join。
 */

import { useEffect } from 'react';
import { unit } from '@/atom/unit';
import { persistApi, persistEvents } from '@/ipc/persist';
import type { AgentDetail } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'agentDetail.atom' });

/**
 * 单 agent 的 detail 槽位。状态机：
 *   - undefined        —— 从未触发过 fetch
 *   - { loading: P }   —— 正在 fetch（inflight 合并）
 *   - { detail: D }    —— hydrated；D=null 表示 main 端确认 agent 不存在
 */
interface Slot {
  detail?: AgentDetail | null;
  loading?: Promise<void>;
}

interface State {
  byId: Record<string, Slot>;
}

const { get, change, use } = unit<State>({ byId: {} });

function patchSlot(agentId: string, mut: (slot: Slot) => Slot): void {
  change((s) => {
    const prev = s.byId[agentId] ?? {};
    const next = mut(prev);
    if (next === prev) return s;
    return { byId: { ...s.byId, [agentId]: next } };
  });
}

async function fetchDetail(agentId: string): Promise<void> {
  const res = await persistApi.getAgentDetail(agentId);
  if (!res.success) {
    logger.warn({ msg: 'getAgentDetail failed', agentId, error: res.error });
    // 失败不缓存：清掉 loading 让下次 ensure 重试
    patchSlot(agentId, (s) => ({ detail: s.detail }));
    return;
  }
  patchSlot(agentId, () => ({ detail: res.data ?? null }));
}

// ────────── 通道订阅 ──────────

persistEvents['profile:switched'](() => {
  change({ byId: {} });
});

persistEvents['agent:updated']((_e, payload) => {
  // detail 直接来自 main 端事件 payload，无需再 invoke。
  // 只更新已被订阅过的 entry（不主动 hydrate 新的 cold 数据）—— 与 scheduleRuns.atom
  // reloadAgent 一致：没人订阅就不预热。
  const slot = get().byId[payload.agentId];
  if (!slot) return;
  patchSlot(payload.agentId, () => ({ detail: payload.detail }));
});

persistEvents['agent:removed']((_e, payload) => {
  change((s) => {
    if (!(payload.agentId in s.byId)) return s;
    const next: Record<string, Slot> = { ...s.byId };
    delete next[payload.agentId];
    return { byId: next };
  });
});

// ─────────────── 公共 API ───────────────

/**
 * 命令式 prefetch：确保 detail 已被加载（成功或失败终态）。
 * agent editor 路由 enter、apply-to-dialog 打开等场景用——把白屏从 hook 渲染瞬间
 * 提前到导航瞬间。同 id 并发调用合并到同一 Promise。
 */
export function ensureAgentDetail(agentId: string): Promise<void> {
  const slot = get().byId[agentId];
  if (slot?.loading) return slot.loading;
  if (slot?.detail !== undefined) return Promise.resolve();
  const p = fetchDetail(agentId);
  patchSlot(agentId, (s) => ({ ...s, loading: p }));
  return p;
}

/**
 * 同步读 cache：命中返 detail，未命中返 null。
 * 给 module-level / event-handler 等非 React 路径用——它们没法用 hook
 * 订阅 atom；典型用法是先 `await ensureAgentDetail(id)` 再 `getAgentDetailSync(id)`，
 * 或读到 null 时降级行为后台触发 ensure 预热下次。
 * cache miss ≠ agent 不存在；想区分要看 `useAgentDetail` 的 hook 路径（main 端确认
 * 不存在时 slot.detail === null，本 helper 同样返 null 但语义可由 caller 判定）。
 */
export function getAgentDetailSync(agentId: string | null | undefined): AgentDetail | null {
  if (!agentId) return null;
  return get().byId[agentId]?.detail ?? null;
}

/**
 * React Hook：订阅某 agent 的 detail。
 * - cache 命中 → 同步返；缺 cache → 触发 fetch 并先返 null（外部展示 skeleton）；
 *   fetch 回来后 atom change 触发本组件 re-render。
 * - main 端确认 agent 不存在时也返 null（slot.detail === null）。
 */
export function useAgentDetail(agentId: string | null | undefined): AgentDetail | null {
  const s = use();
  useEffect(() => {
    if (agentId) void ensureAgentDetail(agentId);
  }, [agentId]);
  if (!agentId) return null;
  return s.byId[agentId]?.detail ?? null;
}
