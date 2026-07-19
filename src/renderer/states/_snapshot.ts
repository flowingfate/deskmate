/**
 * Renderer 端 persist snapshot 共享 hydrate 合流。
 *
 * 背景：`profile/agents/skills/mcp/starred/settings` 6 个 atom 都需要从
 *   `persistApi.getSnapshot()` 一次拉到的完整快照里取自己那块。模块加载副作用会触发
 *   多个 invoke；同 tick fan-out 没有任何业务必要，可以合并。
 *
 * 合流策略：
 *   1. 进程内维护一个 inflight Promise；同 tick 多个调用方共享同一份 await；
 *   2. 成功后缓存整个不可变窗口 Profile 的 snapshot。
 *
 * 失败的 Promise 不缓存，下一次调用方会重试。
 */
import { persistApi } from '@/ipc/persist';
import type { PersistSnapshot } from '@shared/ipc/persist';

type SnapshotResult =
  | { success: true; data: PersistSnapshot }
  | { success: false; error: string };

let cached: PersistSnapshot | null = null;
let inflight: Promise<SnapshotResult> | null = null;

async function fetchSnapshot(): Promise<SnapshotResult> {
  const res = await persistApi.getSnapshot();
  if (!res.success) return { success: false, error: res.error };
  // PersistResult.data 是 optional，但 getSnapshot 在 main 端永远填；保险起见兜底
  if (!res.data) return { success: false, error: 'getSnapshot: empty data' };
  return { success: true, data: res.data };
}

export function getInitialSnapshot(): Promise<SnapshotResult> {
  if (cached) return Promise.resolve({ success: true, data: cached });
  if (inflight) return inflight;
  const pending = fetchSnapshot()
    .then((res) => {
      if (res.success) cached = res.data;
      return res;
    })
    .finally(() => {
      // 仅当 inflight 仍指向自己时清空 —— 防止 invalidate() 已把它换成新的 fetch
      if (inflight === pending) inflight = null;
    });
  inflight = pending;
  return pending;
}

