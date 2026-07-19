/**
 * schedules 域 atom（D6）。
 *
 * 数据：当前 active profile 的全部 schedule jobs（跨 agent 扁平 list）。
 * 真值在 main 端 `Agent.scheduleRegistry`；renderer 通过 `schedulerApi.listJobs()` 拉，
 * 订阅 persist 通道做增量刷新。
 *
 * 策略：粗粒度全量 reload —— 任一 schedule 通道触发都重调 `listJobs()` 拉全表。
 * 单 profile 下 schedule 总量通常 <100，扁平 listJobs 已经是当前 main 端 listJobsFlat 的能力，
 * 比 atom 内自己维护 `agentId × jobId × runState` 的合并逻辑更稳。
 *
 * 订阅通道：
 *   - persist:schedule:updated   → reload
 *   - persist:schedule:removed   → reload
 *   - persist:schedule:run:updated → reload（runState.startedAt / finishedAt 变化也走 listJobs）
 *
 * 写操作走老 `schedulerApi.*` IPC，main 改完反向广播；不需要 atom 自己 mutate。
 */

import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';

import { schedulerApi } from '@/ipc/scheduler';
import type { SchedulerJob } from '@shared/ipc/scheduler';
import { log } from '@/log';

const logger = log.child({ mod: 'schedules.atom' });

interface State {
  jobs: SchedulerJob[];
  hydrated: boolean;
  loading: Promise<void> | null;
}

const EMPTY: SchedulerJob[] = [];

const { get, change, listen, use } = unit<State>({
  jobs: EMPTY,
  hydrated: false,
  loading: null,
});

async function reload(): Promise<void> {
  const prev = get().loading;
  if (prev) return prev;
  const p = (async () => {
    try {
      const res = await schedulerApi.listJobs();
      if (res?.success && res.data) {
        change({ jobs: res.data, hydrated: true, loading: null });
      } else {
        logger.warn({ msg: 'listJobs failed', error: res?.error });
        change((s) => ({ ...s, loading: null }));
      }
    } catch (err) {
      logger.warn({ msg: 'listJobs threw', err });
      change((s) => ({ ...s, loading: null }));
    }
  })();
  change((s) => ({ ...s, loading: p }));
  return p;
}



persistEvents['schedule:updated']((_e, payload) => {
  void reload();
});

persistEvents['schedule:removed']((_e, payload) => {
  void reload();
});

persistEvents['schedule:run:updated']((_e, payload) => {
  void reload();
});

void reload();

// ─────────────── 公共 API ───────────────

export function getSchedules(): SchedulerJob[] {
  return get().jobs;
}

export function useSchedules(): SchedulerJob[] {
  return use().jobs;
}

/**
 * **按 (jobs 引用, agentId) 缓存**：jobs 引用未变时，同一 agentId 返回同一数组引用，
 * 避免把 `useSchedulesByAgentId(id)` 放进 effect / useMemo 依赖时反复触发
 * （`.filter` 每次返回新数组会形成更新循环）。jobs 引用变了就重建子缓存。
 */
let lastJobsRef: SchedulerJob[] | null = null;
const filteredByAgentCache = new Map<string, SchedulerJob[]>();
function filterJobsByAgent(jobs: SchedulerJob[], agentId: string): SchedulerJob[] {
  if (jobs !== lastJobsRef) {
    filteredByAgentCache.clear();
    lastJobsRef = jobs;
  }
  const cached = filteredByAgentCache.get(agentId);
  if (cached) return cached;
  const result = jobs.filter((j) => j.agentId === agentId);
  filteredByAgentCache.set(agentId, result);
  return result;
}

export function useSchedulesByAgentId(agentId: string | null | undefined): SchedulerJob[] {
  const s = use();
  if (!agentId) return EMPTY;
  return filterJobsByAgent(s.jobs, agentId);
}

export function getSchedulesByAgentId(agentId: string | null | undefined): SchedulerJob[] {
  if (!agentId) return EMPTY;
  return filterJobsByAgent(get().jobs, agentId);
}

export function useSchedulesHydrated(): boolean {
  return use().hydrated;
}

export function listenSchedules(cb: (state: State) => void): VoidFunction {
  return listen(cb);
}

/** 显式触发刷新（一般不需要 —— 增量通道已覆盖所有写路径）。 */
export function refreshSchedules(): Promise<void> {
  return reload();
}
