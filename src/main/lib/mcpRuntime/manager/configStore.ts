/**
 * MCP server 配置读写的薄门面。
 *
 * 从旧 `mcpClientManager.ts` 的 `mcp()` / `updateServerConfig` 抽出。
 * **不承担运行时状态** —— 那部分归 `RuntimeStateStore`。
 */

import { Profiles } from '@main/persist';
import type { Mcp } from '@main/persist';
import type { McpServerConfig } from '@shared/persist/types'

/**
 * 拿当前 profile 的 `Mcp` 持久化 handle。bootstrap 后从 cache 出,无 I/O。
 *
 * 4+ 调用点(add / update / delete / performConnect + init 遍历 items),
 * 值得抽出:避免每次重复 `Profiles.get().active().then((p) => p.mcp)`,
 * 也让"MCP 配置的入口"在整个模块只有一处。
 */
export async function activeMcp(): Promise<Mcp> {
  const profile = await Profiles.get().active();
  return profile.mcp;
}

/**
 * Merge-update:仅在 server 存在时覆盖字段并写盘。返回是否命中。
 * `name` 强制回填,防止 caller 传错 patch 把 record 主键改坏。
 */
export async function patchServerConfig(
  serverName: string,
  patch: Partial<McpServerConfig>,
): Promise<boolean> {
  const mcp = await activeMcp();
  const existing = mcp.get(serverName);
  if (!existing) return false;
  await mcp.upsert({ ...existing, ...patch, name: serverName });
  return true;
}
