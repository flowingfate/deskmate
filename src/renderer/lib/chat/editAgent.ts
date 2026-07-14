/**
 * Agent 编辑命令（替代旧的 `agent:editAgent` 自定义 window 事件）。
 *
 * 本命令**不碰任何 atom**——只依赖模块单例 `router`（data router 命令式入口）与
 * `agentSessionCacheManager`。因此就是一个普通函数，不套 atom / mutate（atom 库仅在
 * 需要读写 atom 状态时才用，见 atom/ai.prompt.md）。
 *
 * agentId 省略时回退到当前激活 agent（沿用旧 handler 语义）。
 */

import { router } from '@/entries/main.routes';
import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';

export type AgentEditTab = 'basic' | 'mcp' | 'tools' | 'skills' | 'prompt';

// Tab → 路由段映射，与 AgentEditingView 的 tabToRouteMap 保持同步。
const tabToRouteMap: Record<AgentEditTab, string> = {
  basic: 'basic',
  mcp: 'mcp_servers',
  tools: 'tools',
  skills: 'skills',
  prompt: 'system_prompt',
};

export function editAgent(agentId?: string | null, initialTab?: AgentEditTab): void {
  const targetAgentId = agentId || agentSessionCacheManager.getCurrentAgentId();
  if (!targetAgentId) return;
  const routeTab = initialTab ? tabToRouteMap[initialTab] : 'basic';
  router.navigate(`/agent/${targetAgentId}/settings/${routeTab}`);
}
