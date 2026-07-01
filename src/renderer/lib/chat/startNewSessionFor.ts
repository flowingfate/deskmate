import { newEntityId } from '@shared/persist/id';

/**
 * 生成一个新的 sessionId 并返回。**不会**立即在 main 端落盘——session 的 data.json /
 * messages.jsonl / sessions/index.json 会在首次 streamMessage 走 pi.Agent.getOrCreateSession
 * 时由 lazy create 路径写入。这样用户反复点 "New Chat" 但不发消息切走不会留下空壳 session。
 *
 * ULID 在 renderer 端用 crypto.getRandomValues 生成（80-bit 随机），同步返回，
 * 不再多一次 IPC round-trip。
 */
export async function startNewSessionFor(
  agentId: string,
): Promise<{ success: boolean; chatSessionId?: string; error?: string }> {
  if (!agentId) return { success: false, error: 'agentId is required' };
  const chatSessionId = newEntityId('s');
  return { success: true, chatSessionId };
}
