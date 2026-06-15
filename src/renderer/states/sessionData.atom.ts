/**
 * sessionData 域 atom（D4）。
 *
 * 数据：按 sessionId 缓存 `SessionDataFile`（含 data.json 主体：title / kind / createdAt /
 * updatedAt / star / readStatus / scheduleRun meta 等）。真值在 main `Session.toDataFile()`。
 *
 * 与 `currentSession.atom.ts`（agentId+sessionId pointer）正交：
 *  - currentSession 是"当前路由指向哪个 session"的 UI 状态；
 *  - 本 atom 是"某 session 的磁盘 data.json 内容"的缓存。
 *
 * 订阅通道：
 *   - persist:profile:switched → 清空整张表
 *   - persist:session:updated  → upsert（id 主键）
 *
 * 加载策略：按需 hydrate 单 session（首次 `useSession(id)` 时调 `getSession`），并发共享 promise；
 * 不像 sessionIndex.atom 那样一次性拉某 agent 全部 —— 这里的角色是"detail 视图"，
 * 列表元数据由 sessionIndex.atom 的轻量 entry 承担。
 *
 * 派生 helper `useSessionFilesDir` / `fetchSessionFilesDir`：用于把 chat-input context-menu 的
 * `@` 提到的 session 私有文件接通到 `sessions/{ym}/{s}/files/`（step6.md §5.1 的 W1/W2 恢复点）。
 * 走独立 invoke 而非缓存 —— sandbox 路径仅给搜索 IPC 用，每次开 menu 拉一次最简单可靠。
 */

import { useEffect, useState } from 'react';
import { unit } from '@/atom/unit';
import { persistApi, persistEvents } from '@/ipc/persist';
import type { SessionDataFile, RegularSessionDataFile } from '@shared/persist/types';
import { log } from '@/log';

const logger = log.child({ mod: 'sessionData.atom' });

interface State {
  byId: Record<string, SessionDataFile>;
  loading: Record<string, Promise<void>>;
}

const { get, change, listen, use } = unit<State>({ byId: {}, loading: {} });

function ensureLoaded(agentId: string, sessionId: string): Promise<void> {
  const slot = get();
  if (slot.byId[sessionId]) return Promise.resolve();
  const existing = slot.loading[sessionId];
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await persistApi.getSession(agentId, sessionId);
      if (!res.success) {
        logger.warn({ msg: 'getSession failed', agentId, sessionId, error: res.error });
        change((s) => {
          const { [sessionId]: _drop, ...rest } = s.loading;
          return { ...s, loading: rest };
        });
        return;
      }
      const data = res.data;
      change((s) => {
        const { [sessionId]: _drop, ...restLoading } = s.loading;
        if (!data) {
          return { ...s, loading: restLoading };
        }
        return { byId: { ...s.byId, [sessionId]: data }, loading: restLoading };
      });
    } catch (err) {
      logger.warn({ msg: 'getSession threw', err });
      change((s) => {
        const { [sessionId]: _drop, ...rest } = s.loading;
        return { ...s, loading: rest };
      });
    }
  })();

  change((s) => ({ ...s, loading: { ...s.loading, [sessionId]: p } }));
  return p;
}

// ────────── 通道订阅 ──────────

persistEvents['profile:switched'](() => {
  change({ byId: {}, loading: {} });
});

persistEvents['session:updated']((_e, payload) => {
  change((s) => ({ ...s, byId: { ...s.byId, [payload.sessionId]: payload.data } }));
});

// ─────────────── 公共 API ───────────────

export function getSessionData(sessionId: string | null | undefined): SessionDataFile | null {
  if (!sessionId) return null;
  return get().byId[sessionId] ?? null;
}

export function useSessionData(
  agentId: string | null | undefined,
  sessionId: string | null | undefined,
): SessionDataFile | null {
  const s = use();
  useEffect(() => {
    if (agentId && sessionId) void ensureLoaded(agentId, sessionId);
  }, [agentId, sessionId]);
  if (!agentId || !sessionId) return null;
  return s.byId[sessionId] ?? null;
}

/** session 是否属于 schedule_run（语义同老 `session.schedulerJobId` 非空）。 */
export function useIsScheduledSession(
  agentId: string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  const data = useSessionData(agentId, sessionId);
  return data?.kind === 'schedule_run';
}

export function getRegularSessionData(
  sessionId: string | null | undefined,
): RegularSessionDataFile | null {
  const d = getSessionData(sessionId);
  return d?.kind === 'regular' ? d : null;
}

export function listenSessionData(cb: (state: State) => void): VoidFunction {
  return listen(cb);
}

/**
 * Hook：取某 session 的私有文件 sandbox 绝对路径；未 hydrate 时返 null。
 */
export function useSessionFilesDir(
  agentId: string | null | undefined,
  sessionId: string | null | undefined,
): string | null {
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => {
    if (!agentId || !sessionId) { setDir(null); return; }
    let mounted = true;
    void (async () => {
      try {
        const res = await persistApi.getSessionFilesDir(agentId, sessionId);
        if (!mounted) return;
        setDir(res?.success ? (res.data ?? null) : null);
      } catch {
        if (mounted) setDir(null);
      }
    })();
    return () => { mounted = false; };
  }, [agentId, sessionId]);
  return dir;
}

/** 非 React 调用方（如 context-menu.atom）直接 invoke 取 filesDir。 */
export async function fetchSessionFilesDir(
  agentId: string,
  sessionId: string,
): Promise<string | null> {
  try {
    const res = await persistApi.getSessionFilesDir(agentId, sessionId);
    return res?.success ? (res.data ?? null) : null;
  } catch {
    return null;
  }
}
