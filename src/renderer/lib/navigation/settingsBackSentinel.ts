/**
 * 进入 /settings 路由前由 in-app 入口（agent editor 各 tab）写入的哨兵，
 * 用于让 SettingsPage 的 Back 按钮判断 history 中是否有可回退的应用内条目：
 *
 * - 存在 → 走 `navigate(-1)`，回到真正的来源页（保留 URL / scroll / state）。
 * - 不存在 → 用户从外部深链或刷新落在 /settings，fallback 到一个具体 agent 路由。
 *
 * 仅 renderer 使用；放在 main 也用得到的 shared 下没有意义。
 */

import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import { getAgents, getPrimaryAgentId } from '@/states/agents.atom';

const KEY = 'settingsCameFromApp';

export function markSettingsCameFromApp(): void {
  sessionStorage.setItem(KEY, '1');
}

export function consumeSettingsCameFromApp(): boolean {
  if (sessionStorage.getItem(KEY)) {
    sessionStorage.removeItem(KEY);
    return true;
  }
  return false;
}

/**
 * 选出 Back 兜底要落到的 agent 路由。
 *
 * 优先级：
 *   1. 当前 session 缓存里的 agent（用户进 settings 前最近选中的那一个）
 *   2. profile 的 primary agent
 *   3. agents 列表第一项
 *   4. 都没有 → 返回 `/agent`，由 AgentPage 兜底走 creation 引导
 *
 * 只返回路径，不带 sessionId。AgentPage.syncWithAgentChatManager 会在
 * currentChatSessionId 为空时补一个新 session，保持与正常进入 /agent 一致。
 */
export function resolveSettingsBackFallbackPath(): string {
  const cachedAgentId = agentSessionCacheManager.getCurrentAgentId();
  if (cachedAgentId) return `/agent/${cachedAgentId}`;

  const primaryId = getPrimaryAgentId();
  if (primaryId) return `/agent/${primaryId}`;

  const firstAgent = getAgents()[0];
  if (firstAgent?.id) return `/agent/${firstAgent.id}`;

  return '/agent';
}
