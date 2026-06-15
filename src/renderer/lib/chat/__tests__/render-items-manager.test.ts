/**
 * @vitest-environment jsdom
 *
 * render-items-manager 回归测 —— 聚焦 `reuseUnchangedItems` 在新一轮 messages
 * 注入后,**对 `hasSubsequentConversation` 翻位不会复用旧 section**。
 *
 * 历史 bug:`isSameRenderItem` 之前只比 sectionKey / sourceMessageIndex /
 * tool_calls 引用,忽略 hasSubsequentConversation。一次 turn 跑完再追一条 user
 * 消息时,旧 assistant 的 tool_calls 数组引用没动 → 老 section 被 `reuseUnchangedItems`
 * 整体返回,新算出的 hasSubsequentConversation=true 被丢,UI 卡在"等待中"形态。
 */
import { describe, expect, it } from 'vitest';
import {
  computeRenderItems,
  reuseUnchangedItems,
  type ChatRenderItem,
} from '../render-items-manager';
import type { RenderAssistantMessage, RenderUserMessage } from '../renderMessage';

function user(id: string, content = ''): RenderUserMessage {
  return { role: 'user', id, time: 1, content, attachments: [] };
}

function assistantWithTool(
  id: string,
  toolCallId: string,
  withResponse: boolean,
): RenderAssistantMessage {
  return {
    role: 'assistant',
    id,
    time: 2,
    think: '',
    content: '',
    tool_calls: [
      {
        id: toolCallId,
        name: 'read',
        time: 2,
        args: { path: '/x' },
        ...(withResponse
          ? { response: { time: 3, status: 'success' as const, result: 'ok' } }
          : {}),
      },
    ],
    streamingComplete: true,
  };
}

function getSection(items: ChatRenderItem[]): Extract<ChatRenderItem, { type: 'tool-calls-section' }> {
  const it = items.find((i) => i.type === 'tool-calls-section');
  if (!it || it.type !== 'tool-calls-section') throw new Error('no tool-calls-section');
  return it;
}

describe('render-items-manager.computeRenderItems', () => {
  it('section 单独存在(后无对话) → hasSubsequentConversation=false', () => {
    const items = computeRenderItems([user('u1', 'go'), assistantWithTool('a1', 'tc1', true)]);
    expect(getSection(items).hasSubsequentConversation).toBe(false);
  });

  it('section 后跟 user message → hasSubsequentConversation=true', () => {
    const items = computeRenderItems([
      user('u1', 'go'),
      assistantWithTool('a1', 'tc1', true),
      user('u2', 'next'),
    ]);
    expect(getSection(items).hasSubsequentConversation).toBe(true);
  });

  it('section 后跟有文本的 assistant → hasSubsequentConversation=true', () => {
    const a1 = assistantWithTool('a1', 'tc1', true);
    const a2: RenderAssistantMessage = {
      role: 'assistant',
      id: 'a2',
      time: 4,
      think: '',
      content: 'reply text',
      tool_calls: [],
      streamingComplete: true,
    };
    const items = computeRenderItems([user('u1', 'go'), a1, a2]);
    expect(getSection(items).hasSubsequentConversation).toBe(true);
  });
});

describe('render-items-manager.reuseUnchangedItems', () => {
  it('messages 引用不变 → section item 被引用复用', () => {
    const u1 = user('u1', 'go');
    const a1 = assistantWithTool('a1', 'tc1', true);
    const prev = computeRenderItems([u1, a1]);
    const next = computeRenderItems([u1, a1]);
    const reused = reuseUnchangedItems(prev, next);
    expect(getSection(reused)).toBe(getSection(prev));
  });

  it('追加 user message 后 hasSubsequentConversation 翻 true → 不应复用旧 section', () => {
    const a1 = assistantWithTool('a1', 'tc1', true);
    const u1 = user('u1', 'go');
    const prev = computeRenderItems([u1, a1]);
    expect(getSection(prev).hasSubsequentConversation).toBe(false);

    // a1 引用未变(immer 不动 → tool_calls 引用也不变),但新一条 user 加进来
    const next = computeRenderItems([u1, a1, user('u2', 'follow up')]);
    expect(getSection(next).hasSubsequentConversation).toBe(true);

    const reused = reuseUnchangedItems(prev, next);
    expect(getSection(reused).hasSubsequentConversation).toBe(true);
    // section item 必须是 next 版本,否则就是命中老 bug
    expect(getSection(reused)).toBe(getSection(next));
  });
});
