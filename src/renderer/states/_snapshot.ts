/**
 * Renderer 端 persist snapshot 共享 hydrate 合流。
 *
 * 背景：`profile/agents/subAgents/skills/mcp/starred/settings` 7 个 atom 都需要从
 *   `persistApi.getSnapshot()` 一次拉到的完整快照里取自己那块。模块加载副作用与
 *   `profile:switched` 事件都会触发各 atom 各自 invoke 一次 —— 7 次 IPC + 7 份
 *   完整 snapshot 序列化拷贝。同 tick fan-out 没有任何业务必要，可以合并。
 *
 * 合流策略：
 *   1. 进程内维护一个 inflight Promise；同 tick 多个调用方共享同一份 await；
 *   2. 成功后把 snapshot 缓存到下次 invalidate；
 *   3. `profile:switched` 由本模块内部订阅、自动 invalidate —— 各 atom 收到
 *      `profile:switched` 后直接调 `getInitialSnapshot()` 即可，避免重复 invalidate。
 *
 * 失败处理：失败的 Promise 不缓存，下一次调用方会重试 —— 与各 atom 老的
 *   "失败仅打日志、不抛"行为一致。
 *
 * 隐含顺序：本模块的 `profile:switched` 监听在 import 时就注册；只要 atom 文件
 *   都在收到 `profile:switched` 之前 `await getInitialSnapshot()`，缓存失效顺序
 *   就有保证（无论 atom 与本模块谁先注册监听，invalidate 都先于任何 atom hydrate
 *   触发的新 fetch 起作用，因为 invalidate 是同步的）。
 */
import { persistApi, persistEvents } from '@/ipc/persist';
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

/**
 * 取 snapshot。同 tick 内并发调用共享同一个 inflight Promise；
 * cache 命中时直接 resolve 已有值（不发 IPC）。
 */
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

/**
 * 失效 snapshot 缓存。`profile:switched` 由本模块内部自动调用。
 */
function invalidateSnapshot(): void {
  cached = null;
  inflight = null;
}

// profile 切换后旧 snapshot 失效 —— atom 收到 profile:switched 再调 getInitialSnapshot()
// 会重新拉，且 6 个 atom 的并发 await 仍会被合并成 1 次 IPC。
persistEvents['profile:switched'](() => {
  invalidateSnapshot();
});
