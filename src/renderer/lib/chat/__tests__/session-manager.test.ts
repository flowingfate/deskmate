import { describe, expect, it } from 'vitest';
import {
  aggregateTokenUsage,
  SessionManager,
} from '../session-manager';
import type { RenderAssistantMessage, RenderMessage } from '../renderMessage';

function assistant(id: string, usage?: RenderAssistantMessage['usage']): RenderAssistantMessage {
  return {
    role: 'assistant',
    id,
    time: 1,
    think: '',
    content: '',
    tool_calls: [],
    usage,
    streamingComplete: true,
  };
}

describe('aggregateTokenUsage', () => {
  it('sums every assistant call while ignoring user and legacy assistant messages', () => {
    const messages: RenderMessage[] = [
      { role: 'user', id: 'u1', time: 1, content: 'hello', attachments: [] },
      assistant('a1', { in: 100, out: 20, cache: [30, 4], total: 154 }),
      assistant('legacy'),
      assistant('a2', { in: 7, out: 8, cache: [9, 10], total: 34 }),
    ];

    expect(aggregateTokenUsage(messages)).toEqual({
      in: 107,
      out: 28,
      cache: [39, 14],
      total: 188,
    });
  });
});

describe('SessionManager complete chunks', () => {
  it('records a completed streaming call so the cumulative usage updates immediately', () => {
    const manager = new SessionManager();
    manager.handleChatSessionCacheCreated('s1', 'a1', { messages: [] });

    manager.handleStreamingChunk('s1', {
      type: 'content',
      chunkId: 'chunk-1',
      messageId: 'assistant-1',
      agentId: 'a1',
      chatSessionId: 's1',
      timestamp: 1,
      text: 'done',
    });
    manager.handleStreamingChunk('s1', {
      type: 'complete',
      chunkId: 'chunk-2',
      messageId: 'assistant-1',
      agentId: 'a1',
      chatSessionId: 's1',
      timestamp: 2,
      hasToolCalls: false,
      usage: { in: 11, out: 12, cache: [13, 14], total: 50 },
    });

    const session = manager.getChatSessionCache('s1');
    expect(session?.messages[0]).toMatchObject({
      role: 'assistant',
      usage: { in: 11, out: 12, cache: [13, 14], total: 50 },
    });
    expect(session?.cumulativeTokenUsage).toEqual({
      in: 11,
      out: 12,
      cache: [13, 14],
      total: 50,
    });
  });
});
