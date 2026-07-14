/**
 * subAgents 域 atom（D9）。
 *
 * 数据：当前 active profile 下完整的 `SubAgentConfig[]`（含 display_name / emoji / tools 等
 * 在 AGENT.md body 中的字段）。
 *
 * 订阅通道：
 *   - persist:profile:switched               → 清空 + hydrate
 *   - persist:agent:registry:updated [kind=subAgents] → 重新拉一次 getAll（payload 是
 *     轻量 SubAgentRecord[]，只够侧栏数字；要 emoji/description 必须读完整 config）
 *
 * 写操作走老的 `subAgentApi.add/update/delete/...` 等 IPC（main 端已切 persist）；
 * 完成后 main 会 emit `agent:registry:updated`，atom 触发再次 getAll。
 */

import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';
import { getInitialSnapshot } from '@/states/_snapshot';
import { subAgentApi } from '@/ipc/subAgent';
import type { SubAgentConfig } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'subAgents.atom' });

interface SubAgentsState {
  items: SubAgentConfig[];
  hydrated: boolean;
}

const { get, change, listen, use } = unit<SubAgentsState>({
  items: [],
  hydrated: false,
});

async function hydrateFromSnapshot(): Promise<void> {
  const res = await getInitialSnapshot();
  if (!res.success) {
    logger.warn({ msg: 'getSnapshot failed', error: res.error });
    return;
  }
  change({ items: res.data.subAgents, hydrated: true });
}

async function refreshFromIpc(): Promise<void> {
  try {
    const res = await subAgentApi.getAll();
    if (res.success && Array.isArray(res.data)) {
      change({ items: res.data, hydrated: true });
    }
  } catch (err) {
    logger.warn({ msg: 'subAgentApi.getAll failed', err });
  }
}

persistEvents['profile:switched']((_e, _payload) => {
  change({ items: [], hydrated: false });
  void hydrateFromSnapshot();
});

persistEvents['agent:registry:updated']((_e, payload) => {
  if (payload.kind !== 'subAgents') return;
  void refreshFromIpc();
});

void hydrateFromSnapshot();

// ─────────────── 公共 API ───────────────

export function getSubAgents(): SubAgentConfig[] {
  return get().items;
}

export function useSubAgents(): SubAgentConfig[] {
  return use().items;
}

export function getSubAgentByName(name: string): SubAgentConfig | undefined {
  return get().items.find((s) => s.name === name);
}

export function getSubAgentsStats(): { total: number } {
  const items = get().items;
  return {
    total: items.length,
  };
}

export function listenSubAgents(cb: (state: SubAgentsState) => void): VoidFunction {
  return listen(cb);
}
