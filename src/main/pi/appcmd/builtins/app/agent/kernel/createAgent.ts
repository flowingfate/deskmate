/**
 * Agent "create" 内核 —— by-config 落到显式注入的 `ProfileStore.createAgent` + `agent.patchFront`,
 * 把 front-matter 字段(mcpServers / skills)一次性写进 AGENT.md。
 *
 * 角色:被 `appcmd/builtins/app/agent/add.ts` 调用,业务逻辑的真家。与
 * `mcp/kernel/createServer.ts` 完全对称。
 *
 * 与 `ProfileStore.createAgent` 的边界:本函数只做"参数校验 + 调
 * createAgent + 后续 patchFront",**不**涉及 UI 通知 / 任何 IPC。
 *
 * `signal` 仅做契约形状对齐 —— 该路径下持久化是同步快路径,内部没有可取消的 I/O。
 */

import type { ProfileStore } from '@main/persist';
import type { AgentMcpServer, SkillBindings } from '@shared/persist/types';

export interface CreateAgentArgs {
  name: string;
  emoji?: string;
  /** Avatar URL (optional). */
  avatar?: string;
  /** `role` 字段已不在新模型中持久化。保留入参形态以容忍旧 caller。 */
  role?: string;
  model?: string;
  mcp_servers?: Array<{
    name: string;
    tools?: string[];
  }>;
  system_prompt?: string;
  skills?: string[];
  /** `workspace` 已在 persist 重构中移除(见 overview.md §3.5)。入参忽略。 */
  workspace?: string;
  version?: string;
}

export interface CreateAgentResult {
  success: boolean;
  message: string;
  agent_name?: string;
  agent_id?: string;
  error?: string;
}

const DEFAULT_EMOJI = '🤖';

/**
 * 失败统一通过 `{ success: false, ... }` envelope 回流,不抛 —— caller(appcmd)
 * 按 success 字段分支处理。
 */
export async function createAgentInternal(
  store: ProfileStore,
  args: CreateAgentArgs,
  _opts?: { signal?: AbortSignal },
): Promise<CreateAgentResult> {
  try {
    if (!args.name || typeof args.name !== 'string' || !args.name.trim()) {
      return {
        success: false,
        message: 'Invalid input: name is required and must be a non-empty string',
        error: 'INVALID_INPUT',
      };
    }

    const agentName = args.name.trim();

    const records = store.listAgents();
    if (records.some((r) => r.name === agentName)) {
      return {
        success: false,
        message: `An agent with name "${agentName}" already exists. Please choose a different name.`,
        error: 'AGENT_EXISTS',
      };
    }

    const version = args.version || '1.0.0';

    const agent = await store.createAgent({
      name: agentName,
      version,
      model: args.model,
      emoji: args.emoji || DEFAULT_EMOJI,
      avatar: args.avatar,
      systemPrompt: args.system_prompt,
    });

    const mcpServers: AgentMcpServer[] | undefined = args.mcp_servers
      ? args.mcp_servers.map((s) => ({
          name: s.name,
          tools: Array.isArray(s.tools) ? s.tools : [],
        }))
      : undefined;

    // CLI `--skill foo` 语义 = 第一档 自动启用。转成 SkillBindings 落盘。
    const skillBindings: SkillBindings | undefined = args.skills?.length
      ? Object.fromEntries(args.skills.map((n) => [n, 'live' as const]))
      : undefined;
    await agent.patchFront({
      mcpServers,
      skills: skillBindings,
    });

    return {
      success: true,
      message: `Successfully created agent "${agentName}" with id "${agent.id}".`,
      agent_name: agentName,
      agent_id: agent.id,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error creating agent: ${error instanceof Error ? error.message : String(error)}`,
      error: 'EXECUTION_ERROR',
    };
  }
}
