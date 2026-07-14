import type { Message } from '@shared/persist/types'
import type { ContextState } from '@shared/persist/types'

/**
 * 应用最新一次 CompressionSnapshot:把 [0..earlyPreservedCount) 与
 * [compressedBeforeIndex..] 之间的内容塌缩成单条 summary。snapshot.summary
 * 是 Domain AssistantMessage,直接插入序列中部。
 */
export function buildLlmContext(
  messages: readonly Message[],
  contextState: ContextState,
): Message[] {
  const topSnapshot = contextState.compressions.length > 0
    ? contextState.compressions[contextState.compressions.length - 1]
    : null;

  if (topSnapshot) {
    const { earlyPreservedCount, summary, compressedBeforeIndex } = topSnapshot;
    return [
      ...messages.slice(0, earlyPreservedCount),
      summary,
      ...messages.slice(compressedBeforeIndex),
    ];
  }

  return [...messages];
}
