/**
 * Settings 页 Back 按钮的兜底目标解析。
 *
 * SettingsPage.handleBack 的策略：优先用 `history.state.idx` 判断历史里是否有可回退项，
 * 有则 `navigate(-1)` 回真实来源；没有（深链 / 刷新，settings 是首屏）时调用本函数，
 * 兜底到一个具体 agent 路由。
 *
 * 仅 renderer 使用；放在 main 也用得到的 shared 下没有意义。
 */

import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import { getAgents, getPrimaryAgentId } from '@/states/agents.atom';
import { peekSettingsEntry } from './settingsEntry';

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
  const prev = peekSettingsEntry();
  if (prev) return prev;

  const cachedAgentId = agentSessionCacheManager.getCurrentAgentId();
  if (cachedAgentId) return `/agent/${cachedAgentId}`;

  const primaryId = getPrimaryAgentId();
  if (primaryId) return `/agent/${primaryId}`;

  const firstAgent = getAgents()[0];
  if (firstAgent?.id) return `/agent/${firstAgent.id}`;

  return '/agent';
}
