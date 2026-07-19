/**
 * Agent "list" 内核 —— 列出 owning Profile 内所有 agent 名(去重)。
 *
 * 角色:被 `appcmd/builtins/app/agent/list.ts` 与 `search.ts --installed` 共享。
 * 等同于 `mcp/kernel/searchLibrary.ts::listInstalledInternal` —— 一个 subcommand
 * 两个模式的共用 helper。
 *
 * 失败不抛,统一通过 envelope 回流;`signal` 仅做契约形状对齐。
 */

import type { ProfileStore } from '@main/persist';

export interface ListAgentsResult {
  success: boolean;
  /** List of all agent names */
  agents: string[];
  /** Total number of agents */
  count: number;
  message: string;
}

export async function listAgentsInternal(
  store: ProfileStore,
  _opts?: { signal?: AbortSignal },
): Promise<ListAgentsResult> {
  try {
    const records = store.listAgents();

    // 去重(agentName 可能重复展示,但工具历史行为是去重列出)
    const agentNames: string[] = [];
    for (const rec of records) {
      if (!agentNames.includes(rec.name)) agentNames.push(rec.name);
    }

    return {
      success: true,
      agents: agentNames,
      count: agentNames.length,
      message: agentNames.length > 0
        ? `Found ${agentNames.length} agent(s): ${agentNames.join(', ')}`
        : 'No agents configured in the profile.',
    };
  } catch (error) {
    return {
      success: false,
      agents: [],
      count: 0,
      message: `Error getting all agents: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
