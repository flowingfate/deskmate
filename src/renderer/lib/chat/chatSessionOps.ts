/**
 * Chat Session Operations —— 兼容层。
 *
 * 现仅保留 `deleteChatSession`（DeleteOverlay 使用）。
 * 其余老 API（saveChatSession / getChatSessionFile / getChatSessionList / createNewChatSession）
 * 已无活调用方；persist 模型下：
 *   - messages.jsonl 是 append-only，从不需要 saveChatSession
 *   - sessionIndex.atom + persistApi.getSession/getSessionMessages 取代了 file 拉取
 *   - session 创建走 startNewSessionFor → pi → Agent.createSession
 *
 * 老 alias 形参在新模型下由 main 端 `Profiles.active()` 隐式取，renderer 不再传。
 */

import { persistApi } from '@/ipc/persist';

export interface ChatSessionOperationResult {
  success: boolean;
  error?: string;
  data?: any;
}

/**
 * 删除指定 ChatSession。
 * profile 上下文由 main 端 `Profiles.active()` 隐式取，renderer 不传 alias。
 */
export async function deleteChatSession(
  agentId: string,
  sessionId: string,
): Promise<ChatSessionOperationResult> {
  try {
    const result = await persistApi.deleteSession(agentId, sessionId);
    if (!result.success) {
      return { success: false, error: `Failed to delete ChatSession: ${result.error}` };
    }
    return { success: true, data: { sessionId } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
