/**
 * Agent "set primary" 内核 —— 把指定 agent 设为当前 profile 的 primary
 * (agent 列表首位,启动后默认选中)。
 *
 * 角色:被 `appcmd/builtins/agent/set-primary.ts` 调用。
 *
 * 失败不抛;`signal` 仅做契约形状对齐。
 */

import { Profiles } from '@main/persist';

export interface SetPrimaryArgs {
  /** Agent name */
  agent_name: string;
}

export interface SetPrimaryResult {
  success: boolean;
  /** primary agent name after setting */
  primaryAgent: string;
  /** primary agent name before setting (empty if none was set) */
  previousPrimaryAgent: string;
  message: string;
}

export async function setPrimaryInternal(
  args: SetPrimaryArgs,
  _opts?: { signal?: AbortSignal },
): Promise<SetPrimaryResult> {
  try {
    if (!args || !args.agent_name || typeof args.agent_name !== 'string') {
      return {
        success: false,
        primaryAgent: '',
        previousPrimaryAgent: '',
        message: 'Invalid argument: agent_name is required and must be a non-empty string.',
      };
    }

    const agentName = args.agent_name.trim();
    if (!agentName) {
      return {
        success: false,
        primaryAgent: '',
        previousPrimaryAgent: '',
        message: 'Invalid argument: agent_name cannot be empty.',
      };
    }

    const profile = await Profiles.get().active();
    const records = profile.listAgents();

    const previousId = profile.getPrimaryAgentId();
    const previousName = previousId ? (records.find((r) => r.id === previousId)?.name ?? '') : '';

    const target = records.find((r) => r.name === agentName);
    if (!target) {
      return {
        success: false,
        primaryAgent: previousName,
        previousPrimaryAgent: previousName,
        message: `Agent "${agentName}" not found. Use "app agent list" to see available agents.`,
      };
    }

    if (target.id === previousId) {
      return {
        success: true,
        primaryAgent: agentName,
        previousPrimaryAgent: previousName,
        message: `Agent "${agentName}" is already the primary agent.`,
      };
    }

    await profile.setPrimaryAgent(target.id);

    return {
      success: true,
      primaryAgent: agentName,
      previousPrimaryAgent: previousName,
      message: `Successfully set "${agentName}" as the primary agent. It will now appear first in the agent list and be the default on app startup.`,
    };
  } catch (error) {
    return {
      success: false,
      primaryAgent: '',
      previousPrimaryAgent: '',
      message: `Error setting primary agent: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
