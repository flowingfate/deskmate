/**
 * starred 域 atom（D8）。
 *
 * 数据：当前 active profile 的 starred entry 列表（仅 agentId+sessionId+starredAt 轻量条目）。
 * Step 9 起真值是 main 端 `regular_sessions.starred_at` 列（SQLite），由 `Profile.sessionIdx.listStarred()` 派生；
 * renderer 通过 persist IPC `getSnapshot.data.starred` hydrate + `starred:updated` 增量同步。
 *
 * 订阅通道：
 *   - persist:starred:updated → 整体替换
 *
 * 注意：渲染收藏列表 UI 字段（title / readStatus / agentName 等）已由 D3 sessionIndex.atom
 * 提供（带 star 字段）；本 atom 仅暴露 starred id 集合，用于"是否收藏"判定与列表过滤。
 */

import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';

import { getInitialSnapshot } from '@/states/_snapshot';
import type { StarredSessionEntry } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'starred.atom' });

interface State {
  items: StarredSessionEntry[];
  hydrated: boolean;
}

const EMPTY: StarredSessionEntry[] = [];

const { get, change, listen, use } = unit<State>({ items: EMPTY, hydrated: false });

async function hydrate(): Promise<void> {
  const res = await getInitialSnapshot();
  if (!res.success) {
    logger.warn({ msg: 'getSnapshot failed', error: res.error });
    return;
  }
  change({ items: res.data.starred, hydrated: true });
}



persistEvents['starred:updated']((_e, payload) => {
  change({ items: payload.items, hydrated: true });
});

void hydrate();

// ─────────────── 公共 API ───────────────

export function getStarred(): StarredSessionEntry[] {
  return get().items;
}

export function useStarred(): StarredSessionEntry[] {
  return use().items;
}

export function isStarred(agentId: string, sessionId: string): boolean {
  return get().items.some((e) => e.agentId === agentId && e.sessionId === sessionId);
}

export function useIsStarred(agentId: string | null | undefined, sessionId: string | null | undefined): boolean {
  const s = use();
  if (!agentId || !sessionId) return false;
  return s.items.some((e) => e.agentId === agentId && e.sessionId === sessionId);
}

export function listenStarred(cb: (state: State) => void): VoidFunction {
  return listen(cb);
}
