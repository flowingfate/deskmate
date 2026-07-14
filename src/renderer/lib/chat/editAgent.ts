/**
 * Agent 编辑命令（替代旧的 `agent:editAgent` 自定义 window 事件）。
 *
 * 本命令**不碰任何 atom**——通过独立的 app navigation bridge 导航，并读取
 * `agentSessionCacheManager` 的当前 agent。它不反向导入路由表，避免业务组件与
 * `main.routes.tsx` 形成 ESM 循环依赖。
 *
 * agentId 省略时回退到当前激活 agent（沿用旧 handler 语义）。
 */

import { navigateInApp } from '@/lib/navigation/appNavigation';
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
  navigateInApp(`/agent/${targetAgentId}/settings/${routeTab}`);
}
