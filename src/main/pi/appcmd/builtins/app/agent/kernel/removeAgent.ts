/**
 * Agent "remove" 内核 —— archive 已安装 agent。**破坏性**:由 `appcmd/builtins/app/agent/remove.ts`
 * 的 `--yes` 守门控制是否真正执行。
 *
 * 把老 `manageAgents` facade 的 inline `remove` 抽出来,与 `findAgentByName` 一起单独存。
 *
 * `signal` 仅做契约形状对齐 —— archive 是同步快路径。
 */

import type { Profile } from '@main/profile';

import { findAgentByName } from './findAgent';

export interface RemoveAgentArgs {
  /** Agent name */
  agent_name: string;
}

export interface RemoveAgentResult {
  success: boolean;
  message: string;
  agent_name?: string;
  agent_id?: string;
  error?: string;
}

export async function removeAgentInternal(
  profile: Profile,
  args: RemoveAgentArgs,
  _opts?: { signal?: AbortSignal },
): Promise<RemoveAgentResult> {
  try {
    if (!args.agent_name || typeof args.agent_name !== 'string' || !args.agent_name.trim()) {
      return {
        success: false,
        message: 'Invalid input: agent_name is required and must be a non-empty string',
        error: 'INVALID_INPUT',
      };
    }

    const agentName = args.agent_name.trim();
    const found = await findAgentByName(profile.store, agentName);
    if (!found) {
      return {
        success: false,
        message: `Agent "${agentName}" not found.`,
        error: 'NOT_FOUND',
      };
    }

    await profile.archiveAgent(found.id);

    return {
      success: true,
      message: `Agent "${agentName}" has been removed.`,
      agent_name: agentName,
      agent_id: found.id,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to remove agent: ${error instanceof Error ? error.message : String(error)}`,
      error: 'REMOVE_FAILED',
    };
  }
}
