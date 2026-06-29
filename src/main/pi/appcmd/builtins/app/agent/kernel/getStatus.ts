/**
 * Agent "status" 内核 —— 按名字查询 agent 在当前 active profile 中的状态。
 *
 * 角色:被 `appcmd/builtins/app/agent/status.ts` 调用。
 *
 * 返回二态枚举之一(`AgentStatus`):NotAdded / Added。Added 同时附带 agent_id /
 * emoji / model 等便捷字段,LLM 一次性拿全。
 *
 * 失败不抛,`signal` 仅做契约形状对齐。
 */

import { Profiles } from '@main/persist';

export type AgentStatus = 'NotAdded' | 'Added';

export interface GetStatusArgs {
  agent_name: string;
}

export interface GetStatusResult {
  success: boolean;
  agent_name: string;
  status: AgentStatus;
  message: string;
  details?: {
    /** agentId == agentId in the new persist model. */
    agent_id?: string;
    emoji?: string;
    model?: string;
  };
}

export async function getStatusInternal(
  args: GetStatusArgs,
  _opts?: { signal?: AbortSignal },
): Promise<GetStatusResult> {
  try {
    if (!args.agent_name || typeof args.agent_name !== 'string' || !args.agent_name.trim()) {
      return {
        success: false,
        agent_name: args.agent_name || '',
        status: 'NotAdded',
        message: 'Invalid input: agent_name is required and must be a non-empty string',
      };
    }

    const agentName = args.agent_name.trim();

    const profile = await Profiles.get().active();
    const records = profile.listAgents();
    const rec = records.find((r) => r.name === agentName);

    if (!rec) {
      return {
        success: true,
        agent_name: agentName,
        status: 'NotAdded',
        message: `Agent "${agentName}" is not added to the profile.`,
      };
    }

    const agent = await profile.getAgent(rec.id);
    return {
      success: true,
      agent_name: agentName,
      status: 'Added',
      message: `Agent "${agentName}" is added to the profile.`,
      details: {
        agent_id: rec.id,
        emoji: rec.emoji,
        model: agent?.config.model,
      },
    };
  } catch (error) {
    return {
      success: false,
      agent_name: args.agent_name || '',
      status: 'NotAdded',
      message: `Error checking agent status: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
