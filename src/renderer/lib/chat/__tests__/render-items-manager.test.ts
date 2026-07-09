/**
 * @vitest-environment jsdom
 *
 * render-items-manager 回归测 —— 模块只产**纯数据**;dim/live 这类位置派生量
 * 已下放给 `ChatContainer` 的 iterator,本文件不再覆盖。
 *
 * 覆盖三件事:
 *   1. 相邻"空文本 + 仅 tool_calls"的 assistant 合并成单个 section,
 *      sectionKey = `tool-section-${firstId}__${lastId}`;text assistant / user 截断 merge 链。
 *   2. `item.index` 在所有 item 类型里统一为 items 数组下标(render-items 坐标)。
 *      —— 修复了 user/assistant 上是 messages 坐标、tool-section 上是 items 坐标的同名异义。
 *   3. `reuseUnchangedItems` 在 messages 不变时复用旧 section;sectionKey 或 toolCalls 任一变化都不复用。
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
  content = '',
): RenderAssistantMessage {
  return {
    role: 'assistant',
    id,
    time: 2,
    think: '',
    content,
    tool_calls: [
      {
        id: toolCallId,
        name: 'read',
        time: 2,
        args: { path: '/x' },
        ...(withResponse
          ? { response: { time: 3, status: 'success' as const, result: 'ok', images: [] } }
          : {}),
      },
    ],
    streamingComplete: true,
  };
}

function getSections(items: ChatRenderItem[]): Extract<ChatRenderItem, { type: 'tool-calls-section' }>[] {
  return items.filter(
    (i): i is Extract<ChatRenderItem, { type: 'tool-calls-section' }> =>
      i.type === 'tool-calls-section',
  );
}

describe('render-items-manager.computeRenderItems — merging', () => {
  it('两条相邻 empty-only-tools assistant → 合并成 1 个 section', () => {
    const items = computeRenderItems([
      user('u1', 'go'),
      assistantWithTool('a1', 'tc1', true),
      assistantWithTool('a2', 'tc2', false),
    ]);
    const sections = getSections(items);
    expect(sections).toHaveLength(1);
    expect(sections[0].sectionKey).toBe('tool-section-a1__a2');
    expect(sections[0].toolCalls.map((tc) => tc.id)).toEqual(['tc1', 'tc2']);
  });

  it('text+tools assistant 起新 merge 链 — 后续 empty-only tool 链并入同一 section', () => {
    const items = computeRenderItems([
      user('u1', 'go'),
      assistantWithTool('a1', 'tc1', true), // empty + tools
      assistantWithTool('a2', 'tc2', true, 'reply text'), // text + tools — 截断前链, 起新链
      assistantWithTool('a3', 'tc3', false), // empty + tools (并入 a2 链)
      assistantWithTool('a4', 'tc4', false), // empty + tools (并入 a2 链)
    ]);
    const sections = getSections(items);
    expect(sections.map((s) => s.sectionKey)).toEqual([
      'tool-section-a1__a1',
      'tool-section-a2__a4',
    ]);
    expect(sections[1].toolCalls.map((tc) => tc.id)).toEqual(['tc2', 'tc3', 'tc4']);
  });

  it('text-only assistant (无 tool_calls) 截断 merge 链 → 前后各 1 个 section', () => {
    const items = computeRenderItems([
      user('u1', 'go'),
      assistantWithTool('a1', 'tc1', true), // empty + tools
      {
        role: 'assistant',
        id: 'a2',
        time: 4,
        think: '',
        content: 'pure reply',
        tool_calls: [],
        streamingComplete: true,
      },
      assistantWithTool('a3', 'tc3', false), // empty + tools
    ]);
    const sections = getSections(items);
    expect(sections.map((s) => s.sectionKey)).toEqual([
      'tool-section-a1__a1',
      'tool-section-a3__a3',
    ]);
  });

  it('user message 截断 merge 链', () => {
    const items = computeRenderItems([
      user('u1', 'go'),
      assistantWithTool('a1', 'tc1', true),
      user('u2', 'next'),
      assistantWithTool('a2', 'tc2', false),
    ]);
    const sections = getSections(items);
    expect(sections.map((s) => s.sectionKey)).toEqual([
      'tool-section-a1__a1',
      'tool-section-a2__a2',
    ]);
  });
});

describe('render-items-manager.computeRenderItems — item.index 一致性', () => {
  it('所有 item 类型的 index 都是 items 数组下标', () => {
    const items = computeRenderItems([
      user('u1', 'go'),
      assistantWithTool('a1', 'tc1', true),                // empty + tools → 单 section
      user('u2', 'next'),
      assistantWithTool('a2', 'tc2', true, 'reply text'),  // text + tools → assistant + section
    ]);
    // 期望: [user(0), section(1), user(2), assistant(3), section(4)]
    expect(items.map((it) => [it.type, it.index])).toEqual([
      ['user', 0],
      ['tool-calls-section', 1],
      ['user', 2],
      ['assistant', 3],
      ['tool-calls-section', 4],
    ]);
  });
});

describe('render-items-manager.reuseUnchangedItems', () => {
  it('messages 引用不变 → section item 被引用复用', () => {
    const u1 = user('u1', 'go');
    const a1 = assistantWithTool('a1', 'tc1', true);
    const prev = computeRenderItems([u1, a1]);
    const next = computeRenderItems([u1, a1]);
    const reused = reuseUnchangedItems(prev, next);
    expect(getSections(reused)[0]).toBe(getSections(prev)[0]);
  });

  it('追加 empty-only-tools assistant 触发 merge → sectionKey 变 → 不应复用旧 section', () => {
    const a1 = assistantWithTool('a1', 'tc1', true);
    const u1 = user('u1', 'go');
    const prev = computeRenderItems([u1, a1]);
    expect(getSections(prev)[0].sectionKey).toBe('tool-section-a1__a1');

    const a2 = assistantWithTool('a2', 'tc2', false);
    const next = computeRenderItems([u1, a1, a2]);
    expect(getSections(next)[0].sectionKey).toBe('tool-section-a1__a2');

    const reused = reuseUnchangedItems(prev, next);
    // 不同 stable key → 完全是 next 的引用
    expect(getSections(reused)[0]).toBe(getSections(next)[0]);
  });

  it('追加 user message → section index 变 → 不应复用旧 section (memo 通过 index 失效)', () => {
    const u1 = user('u1', 'go');
    const a1 = assistantWithTool('a1', 'tc1', true);
    const prev = computeRenderItems([u1, a1]);
    expect(getSections(prev)[0].index).toBe(1);

    // user 加在前面 → a1 的 section 从 index=1 变成 index=2
    const u0 = user('u0', 'pre');
    const next = computeRenderItems([u0, u1, a1]);
    expect(getSections(next)[0].index).toBe(2);

    const reused = reuseUnchangedItems(prev, next);
    expect(getSections(reused)[0]).toBe(getSections(next)[0]);
  });
});
