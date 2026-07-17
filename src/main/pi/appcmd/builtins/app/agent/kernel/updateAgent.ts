/**
 * Agent "update" 内核 —— 自动 patch+1 已安装 agent 的字段。
 *
 * 角色:被 `appcmd/builtins/app/agent/update.ts` 调用。
 *
 * 升级规则: version 自动 patch+1; mcp_servers / skills 整体替换 ——
 * 给了就用新的,没给就保留(undefined 跳过赋值)。
 *
 * `signal` 仅做契约形状对齐 —— profile 写盘没有 abort 中断点。
 */

import type { ProfileStore } from '@main/persist';
import type { AgentMcpServer, SkillBindings } from '@shared/persist/types';

interface AgentMcpServerInput {
  name: string;
  tools?: string[];
}


export interface UpdateAgentArgs {
  agent_config: {
    name: string;
    version?: string;
    model?: string;
    emoji?: string;
    avatar?: string;
    system_prompt?: string;
    mcp_servers?: AgentMcpServerInput[];
    skills?: string[];
  };
}

export interface UpdateAgentResult {
  success: boolean;
  message: string;
  agent_name?: string;
  agent_id?: string;
  old_version?: string;
  new_version?: string;
  error?: string;
}

function incrementPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) return `${version}.1`;
  const [major, minor, patch] = parts;
  const patchNum = parseInt(patch, 10);
  if (isNaN(patchNum)) return `${version}.1`;
  return `${major}.${minor}.${patchNum + 1}`;
}


export async function updateAgentInternal(
  store: ProfileStore,
  args: UpdateAgentArgs,
  _opts?: { signal?: AbortSignal },
): Promise<UpdateAgentResult> {
  try {
    if (!args.agent_config || typeof args.agent_config !== 'object') {
      return {
        success: false,
        message: 'Invalid input: agent_config is required and must be an object',
        error: 'INVALID_INPUT',
      };
    }

    const config = args.agent_config;

    if (!config.name || typeof config.name !== 'string' || !config.name.trim()) {
      return {
        success: false,
        message: 'Invalid input: agent_config.name is required and must be a non-empty string',
        error: 'INVALID_INPUT',
      };
    }

    const agentName = config.name.trim();
    const records = store.listAgents();
    const target = records.find((r) => r.name === agentName);
    if (!target) {
      return {
        success: false,
        message: `Agent "${agentName}" is not installed. Use "app agent add" first.`,
        error: 'NOT_INSTALLED',
      };
    }

    const agent = await store.getAgent(target.id);
    if (!agent) {
      return {
        success: false,
        message: `Agent "${agentName}" record exists but AGENT.md is missing.`,
        error: 'AGENT_MD_MISSING',
      };
    }

    const oldVersion = agent.config.version || '1.0.0';
    const finalVersion = incrementPatchVersion(oldVersion);

    let finalMcpServers: AgentMcpServer[] | undefined;
    if (config.mcp_servers !== undefined) {
      finalMcpServers = (config.mcp_servers || []).map((s) => ({
        name: s.name,
        tools: Array.isArray(s.tools) ? s.tools : [],
      }));
    }

    // CLI `--skill foo` 语义 = 第一档 自动启用；整体替换 SkillBindings。
    let finalSkills: SkillBindings | undefined;
    if (config.skills !== undefined) {
      finalSkills = Object.fromEntries(config.skills.map((n) => [n, 'live' as const]));
    }

    if (config.system_prompt !== undefined) {
      agent.systemPrompt = config.system_prompt;
    }
    await agent.patchFront({
      version: finalVersion,
      emoji: config.emoji !== undefined ? config.emoji : agent.config.emoji,
      avatar: config.avatar !== undefined ? config.avatar : agent.config.avatar,
      model: config.model !== undefined ? config.model : agent.config.model,
      mcpServers: finalMcpServers,
      skills: finalSkills,
    });

    return {
      success: true,
      message: `Successfully updated Agent "${agentName}". Version: ${oldVersion} -> ${finalVersion}.`,
      agent_name: agentName,
      agent_id: agent.id,
      old_version: oldVersion,
      new_version: finalVersion,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error updating Agent: ${error instanceof Error ? error.message : String(error)}`,
      error: 'EXECUTION_ERROR',
    };
  }
}
