/**
 * 给 ModelPicker / AgentBasicTab 用的"按 provider 分组的模型列表"。
 *
 * 数据源：
 * - 已登录 provider 列表：piApi.listAccounts()
 * - 每个 provider 的模型：piApi.listModelsForProvider()
 *
 * 行为约定（见 step9.md "不做的事"）：
 * - 只展示已登录 provider；未登录的 provider 不在列表里出现
 * - 不缓存解析结果；每次 hook mount 都现查
 *
 * 失败容忍：单个 provider 取列表失败时跳过它，不让整个列表崩。错误日志写
 * 到 console（dev 模式可见），UI 不弹错——多 provider 场景下偶发失败不应
 * block 用户从其他 provider 选模型。
 */

import { useEffect, useState } from 'react';
import { piApi } from '@/ipc/pi';
import type { PiModelListItem } from '@shared/ipc/pi';
import { PROVIDER_REGISTRY } from '@/components/settings/auth/providerRegistry';

export interface ProviderModelGroup {
  providerId: string;
  providerName: string;
  models: PiModelListItem[];
}

export interface UseGroupedProviderModelsResult {
  groups: ProviderModelGroup[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGroupedProviderModels(): UseGroupedProviderModelsResult {
  const [groups, setGroups] = useState<ProviderModelGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const accountsRes = await piApi.listAccounts();
      if (!accountsRes.success) {
        throw new Error(accountsRes.error);
      }
      const loggedIn = accountsRes.data ?? [];

      const collected: ProviderModelGroup[] = [];
      for (const acc of loggedIn) {
        const desc = PROVIDER_REGISTRY.find((p) => p.id === acc.provider);
        const providerName = desc?.name ?? acc.provider;
        const listRes = await piApi.listModelsForProvider(acc.provider);
        if (!listRes.success) {
          console.warn(`[useGroupedProviderModels] ${acc.provider}: ${listRes.error}`);
          continue;
        }
        const models = listRes.data ?? [];
        if (models.length === 0) continue;
        collected.push({ providerId: acc.provider, providerName, models });
      }
      setGroups(collected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGroups([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { groups, isLoading, error, refresh };
}
