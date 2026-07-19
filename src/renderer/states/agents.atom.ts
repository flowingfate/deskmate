/**
 * agents 域 atom。
 *
 * 数据形状：`AgentRecord`（即 `agents.json#items` 行，列表展示字段集）。
 * 真值在 main 端 persist 层；本 atom 通过 persist IPC 通道同步。
 *
 * 订阅通道：
 *   - persist:agent:registry:updated (kind='agents') → 同步顺序 + primaryAgentId
 *   - persist:agent:updated         → upsert 单个 agent（仅 record；detail 在 agentDetail.atom）
 *   - persist:agent:removed         → 从 byId 删除
 *
 * 写操作走 persist invoke 通道（persistApi.patchAgentFront / archiveAgent / ...），
 * main 端落盘后会通过 agent:updated 广播回来，本 atom 自动更新；不导出 change。
 *
 * **cold 字段（systemPrompt / mcpServers / skills / delegates / knowledge /
 *   thinkingLevel）不在这里**，去 `agentDetail.atom` 拿。设计动机：详见
 *   `REFACTOR-LAZY-AGENT.md` 与 `ai.prompt/persist.md §7` 的 "AgentRecord ↔ AGENT.md
 *   同步契约"。
 */

import { produce } from 'immer';
import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';

import { getInitialSnapshot } from '@/states/_snapshot';
import { CurrentSession } from '@/states/currentSession.atom';
import type { AgentRecord } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'agents.atom' });

interface AgentsState {
  byId: Record<string, AgentRecord>;
  /** items 的顺序（即 AgentRegistryFile.items 顺序），决定 useAgents() 排序。 */
  orderedIds: string[];
  primaryAgentId: string | undefined;
  hydrated: boolean;
}

const { get, change, listen, use } = unit<AgentsState>({
  byId: {},
  orderedIds: [],
  primaryAgentId: undefined,
  hydrated: false,
});

/**
 * 从 main 端拉一次完整快照。模块加载时立刻调用；profile 切换时再调一次。
 * 失败仅打日志，不抛 —— 避免登录早期 race 阻塞 UI。
 */
async function hydrate(): Promise<void> {
  const res = await getInitialSnapshot();
  if (!res.success) {
    logger.warn({ msg: 'getSnapshot failed', error: res.error });
    return;
  }
  const data = res.data!;
  change(produce((draft: AgentsState) => {
    draft.byId = {};
    draft.orderedIds = [];
    for (const r of data.agents) {
      draft.byId[r.id] = r;
      draft.orderedIds.push(r.id);
    }
    draft.primaryAgentId = data.primaryAgentId;
    draft.hydrated = true;
  }));
}

// 通道订阅。模块加载即生效；renderer 进程退出时整体被销毁，无需手动 off。


persistEvents['agent:registry:updated']((_e, payload) => {
  if (payload.kind !== 'agents') return;
  change(produce((draft: AgentsState) => {
    const items = payload.items as AgentRecord[];
    draft.orderedIds = items.map((r) => r.id);
    // registry 事件 payload 含完整 items —— 顺便重建 byId 也是合理的，
    // 但出于"事件最小语义"原则只更新 orderedIds + primaryAgentId；
    // 单条 record 改动由 agent:updated 推送。
    draft.primaryAgentId = payload.primaryAgentId;
  }));
});

persistEvents['agent:updated']((_e, payload) => {
  change(produce((draft: AgentsState) => {
    draft.byId[payload.agentId] = payload.record;
  }));
});

persistEvents['agent:removed']((_e, payload) => {
  change(produce((draft: AgentsState) => {
    delete draft.byId[payload.agentId];
  }));
});

void hydrate();

/**
 * 按 orderedIds 排序的 AgentRecord 列表。orderedIds 中存在但 byId 缺失的 id 静默跳过
 * （registry 与 agent:updated 到达存在窗口期）。byId 中存在但 orderedIds 缺漏的追加到末尾。
 *
 * **按 state 引用缓存**：`change` 在 state 未实际变化时保留旧引用（见 unit.ts `Object.is`
 * bail-out + immer 未修改时的 structural sharing），因此引用一致即结果一致。这是
 * `useAgents()` 在 effect 依赖中保持稳定的关键 —— 否则每次 render 返回新数组会触发
 * 把 `agents` 放进依赖的 effect 反复执行（v2.7.x 多个 dialog 出现的 "Maximum update
 * depth exceeded" 即此因）。
 */
let lastOrderedState: AgentsState | null = null;
let lastOrderedResult: AgentRecord[] = [];
function listOrdered(state: AgentsState): AgentRecord[] {
  if (state === lastOrderedState) return lastOrderedResult;
  const out: AgentRecord[] = [];
  const seen = new Set<string>();
  for (const id of state.orderedIds) {
    const v = state.byId[id];
    if (v) {
      out.push(v);
      seen.add(id);
    }
  }
  for (const id of Object.keys(state.byId)) {
    if (!seen.has(id)) out.push(state.byId[id]);
  }
  lastOrderedState = state;
  lastOrderedResult = out;
  return out;
}

// ─────────────── 公共 API ───────────────

/** 同步取按顺序排好的全部 agent。 */
export function getAgents(): AgentRecord[] {
  return listOrdered(get());
}

/** React Hook：订阅 agents 列表。 */
export function useAgents(): AgentRecord[] {
  return listOrdered(use());
}

/** 同步按 id 取单个 agent。 */
export function getAgentById(id: string | null | undefined): AgentRecord | null {
  if (!id) return null;
  return get().byId[id] ?? null;
}

/** React Hook：订阅单个 agent（id 变化或 agent 更新都会重渲染）。 */
export function useAgentById(id: string | null | undefined): AgentRecord | null {
  const s = use();
  if (!id) return null;
  return s.byId[id] ?? null;
}

/** 当前 primary agent id（未设置返回 null）。 */
export function getPrimaryAgentId(): string | null {
  return get().primaryAgentId ?? null;
}

/** React Hook：订阅 primary agent id。 */
export function usePrimaryAgentId(): string | null {
  return use().primaryAgentId ?? null;
}


/** 非 React 代码订阅 agents 列表变化。 */
export function listenAgents(cb: (agents: AgentRecord[]) => void): VoidFunction {
  return listen((s) => cb(listOrdered(s)));
}

/**
 * React Hook：订阅当前激活的 agent。
 * 数据来源：`CurrentSession.agentId`（路由级 source of truth，与 agentId 1:1）。
 * agent 内容变化或 agentId 切换都会重渲染。
 */
export function useCurrentAgent(): AgentRecord | null {
  const { agentId } = CurrentSession.use();
  return useAgentById(agentId);
}
