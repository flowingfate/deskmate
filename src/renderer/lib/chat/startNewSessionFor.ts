import { agentSessionCacheManager } from './agentSessionCacheManager';
import { log } from '@/log';
import { newEntityId } from '@shared/persist/id';
import { persistApi } from '@/ipc/persist';
const logger = log.child({ mod: 'StartNewChatFor' });

export interface GreetingConfig {
  markdownContent: string;
}

function applyGreeting(chatSessionId: string, markdownContent: string): void {
  let retries = 0;
  const maxRetries = 10;
  const retryDelay = 100;
  const retry = () => {
    const success = agentSessionCacheManager.setGreetingContent(chatSessionId, markdownContent);
    if (success) return;
    if (retries < maxRetries) {
      retries++;
      setTimeout(retry, retryDelay);
    } else {
      logger.error({ msg: "Greeting cache not found after max retries:", data: chatSessionId });
    }
  };
  retry();
}

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
  greetingConfig?: GreetingConfig,
): Promise<{ success: boolean; chatSessionId?: string; error?: string }> {
  if (!agentId) return { success: false, error: 'agentId is required' };
  const chatSessionId = newEntityId('s');
  // greeting 优先用调用方显式传入；否则查 agent detail.zeroStates.greeting。
  // zeroStates 是 cold 字段，本地若无 cache 走 IPC 一次（与原来访问 getAgentById
  // 同步路径相比多一次 round-trip，但仅 "New Chat" 时执行，可接受）。
  let greeting: string | null = greetingConfig?.markdownContent?.trim() || null;
  if (!greeting) {
    try {
      const res = await persistApi.getAgentDetail(agentId);
      if (res.success) {
        greeting = res.data?.zeroStates?.greeting?.trim() || null;
      }
    } catch (err) {
      logger.warn({ msg: 'getAgentDetail failed when reading greeting', agentId, err });
    }
  }
  if (greeting) {
    applyGreeting(chatSessionId, greeting);
  }
  return { success: true, chatSessionId };
}
