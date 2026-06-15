/**
 * Local tools registry 的 renderer 端薄壳。
 *
 * 数据源是 main `ToolsRegistry`(`src/main/pi/tools/`),通过 `tools` IPC
 * 同步取一次。registry 是模块加载期静态填的,运行时不变,所以这里只在首次
 * 订阅时拉一次并 cache,不做轮询、不挂 IPC event(没必要)。
 *
 * 暴露:
 * - `useLocalTools()` — React Hook,返回当前注册的所有 LocalToolInfo。
 * - `useLocalToolsLoading()` — 首次拉取期间 true。
 * - `refreshLocalTools()` — 主动重拉(理论上不需要,留 escape hatch)。
 *
 * 不放 atom 进 `mcpRuntime.atom` —— 两条独立数据源,合并只会让代码更乱。
 */

import { useEffect, useState } from 'react';
import { toolsApi } from '@/ipc/tools';
import type { LocalToolInfo } from '@shared/types/toolsTypes';
import { log } from '@/log';

const logger = log.child({ mod: 'tools.atom' });

type Snapshot = {
  tools: LocalToolInfo[];
  loading: boolean;
};

const listeners = new Set<(snap: Snapshot) => void>();
let snapshot: Snapshot = { tools: [], loading: false };
let fetched = false;
let inflight: Promise<void> | null = null;

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      logger.error({ msg: 'Listener error', err });
    }
  }
}

async function fetchOnce(): Promise<void> {
  if (inflight) return inflight;
  snapshot = { tools: snapshot.tools, loading: true };
  notify();
  inflight = (async () => {
    try {
      const result = await toolsApi.getAll();
      if (result.success && result.data) {
        snapshot = { tools: result.data, loading: false };
      } else {
        logger.warn({ msg: 'toolsApi.getAll returned failure', err: result.error });
        snapshot = { tools: [], loading: false };
      }
    } catch (err) {
      logger.error({ msg: 'toolsApi.getAll threw', err });
      snapshot = { tools: [], loading: false };
    } finally {
      fetched = true;
      inflight = null;
      notify();
    }
  })();
  return inflight;
}

/** React Hook:本地工具列表(LocalToolInfo)。首次订阅时自动拉取。 */
export function useLocalTools(): LocalToolInfo[] {
  const [_, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    if (!fetched && !inflight) {
      void fetchOnce();
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot.tools;
}

/** React Hook:首次拉取进行中时返回 true。 */
export function useLocalToolsLoading(): boolean {
  const [_, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot.loading;
}

/** 同步读取当前 snapshot(非 React 路径)。 */
export function getLocalToolsSnapshot(): LocalToolInfo[] {
  return snapshot.tools;
}

/** 主动重拉(escape hatch,正常不需要)。 */
export async function refreshLocalTools(): Promise<void> {
  await fetchOnce();
}
