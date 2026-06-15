/**
 * mcp registry 域 atom（D11）。
 *
 * 数据：当前 active profile 的 `mcp/mcp-servers.json` 配置项（`McpServerRecord[]`，
 * 等同 `McpServerConfig`）。**只管配置层**；runtime 状态（status / tools / lastError）
 * 仍由 `mcpClientCacheManager` 维护。
 *
 * 订阅通道：
 *   - persist:profile:switched                    → 清空 + hydrate
 *   - persist:agent:registry:updated [kind=mcp]   → payload.items 直接替换
 *
 * 副作用：每次 items 更新会主动调用 `mcpClientCacheManager.updateServerConfigs(items)`，
 * 让客户端 cache 把新配置合并进 runtime 状态映射。这是老 profileDataManager 路径
 * 的替代品 —— PR-L 中可把这个胶水进一步内化到 mcpClientCacheManager 自己监听通道。
 */

import { unit } from '@/atom/unit';
import { persistEvents } from '@/ipc/persist';
import { getInitialSnapshot } from '@/states/_snapshot';
import type { McpServerRecord } from '@shared/persist/types';
import { mcpClientCacheManager } from '@/lib/mcp/mcpClientCacheManager';
import { log } from '@/log';

const logger = log.child({ mod: 'mcp.atom' });

interface McpState {
  items: McpServerRecord[];
  hydrated: boolean;
}

const { get, change, listen, use } = unit<McpState>({
  items: [],
  hydrated: false,
});

function applyToClientCache(items: McpServerRecord[]): void {
  try {
    mcpClientCacheManager.updateServerConfigs(items);
  } catch (err) {
    logger.error({ msg: 'Failed to sync MCP configs to client cache', err });
  }
}

async function hydrate(): Promise<void> {
  const res = await getInitialSnapshot();
  if (!res.success) {
    logger.warn({ msg: 'getSnapshot failed', error: res.error });
    return;
  }
  const items = res.data.mcp;
  change({ items, hydrated: true });
  applyToClientCache(items);
}

persistEvents['profile:switched'](() => {
  change({ items: [], hydrated: false });
  applyToClientCache([]);
  void hydrate();
});

persistEvents['agent:registry:updated']((_e, payload) => {
  if (payload.kind !== 'mcp') return;
  const items = payload.items as McpServerRecord[];
  change({ items, hydrated: true });
  applyToClientCache(items);
});

void hydrate();

// ─────────────── 公共 API ───────────────

/** 同步取 mcp 注册表（纯配置；runtime 状态走 mcpClientCacheManager）。 */
export function getMcpServers(): McpServerRecord[] {
  return get().items;
}

export function useMcpServers(): McpServerRecord[] {
  return use().items;
}

export function getMcpServerByName(name: string): McpServerRecord | null {
  return get().items.find((s) => s.name === name) ?? null;
}

export function listenMcpServers(cb: (state: McpState) => void): VoidFunction {
  return listen(cb);
}
