/**
 * 按复合 modelKey `${provider}::${modelId}` 异步查询单个模型的能力描述。
 *
 * 取代老 `getModelById` / `getModelCapabilities`（基于全量 GHC 缓存）的同步
 * 查表。pi 多 provider 后没有"全量"，必须按需查询。
 *
 * 渲染端缓存：模型能力（contextWindow / supports / reasoning level）在应用
 * 运行期内视为不变量 —— pi 内置 model 表是静态的；GHC 列表 main 端定期刷新
 * 但具体模型的能力字段不会变。所以按 modelKey 缓存 Promise 即可：
 *
 * - 命中：直接复用同一个 Promise（不论已 resolve 还是 in-flight）
 * - 失败：从缓存里移除，下次调用重新发请求（避免一次网络抖动永久 sticky）
 *
 * 多个组件同时 mount 同一 modelKey 也只产生一次 IPC 调用。
 */

import { useEffect, useRef, useState } from 'react';
import { piApi } from '@/ipc/pi';
import type { PiModelInfo } from '@shared/ipc/pi';

export interface UseModelInfoResult {
  info: PiModelInfo | null;
  isLoading: boolean;
  error: string | null;
}

const cache = new Map<string, Promise<PiModelInfo | null>>();

function fetchModelInfo(modelKey: string): Promise<PiModelInfo | null> {
  const cached = cache.get(modelKey);
  if (cached) return cached;

  const promise = piApi
    .getModelInfo(modelKey)
    .then((res) => {
      if (!res.success) {
        // 不缓存失败：让下一次调用重试，避免暂时性失败永久 sticky
        cache.delete(modelKey);
        throw new Error(res.error);
      }
      return res.data ?? null;
    })
    .catch((err: unknown) => {
      cache.delete(modelKey);
      throw err;
    });

  cache.set(modelKey, promise);
  return promise;
}

export function useModelInfo(modelKey: string | null | undefined): UseModelInfoResult {
  const [info, setInfo] = useState<PiModelInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!modelKey) {
      setInfo(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    fetchModelInfo(modelKey)
      .then((data) => {
        if (!mounted.current) return;
        setInfo(data);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setInfo(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (mounted.current) setIsLoading(false);
      });
  }, [modelKey]);

  return { info, isLoading, error };
}

/** 仅测试用：清空 in-memory 缓存 */
export function __clearModelInfoCache(): void {
  cache.clear();
}
