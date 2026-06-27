/**
 * messageWire.rehydrate / dehydrate 纯函数单测。
 *
 * 不依赖文件系统 / DB；只验证 JSONL 行序列与 Domain Message 数组之间的双向转换。
 */
import { describe, expect, it } from 'vitest';

import { dehydrate, rehydrate } from '../messageWire';
import type {
  PersistedAssistantMessage,
  PersistedJsonLine,
  PersistedToolResponse,
  PersistedUserMessage,
} from '@shared/persist/types';
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from '@shared/types/message';

const u = (overrides: Partial<UserMessage> = {}): UserMessage => ({
  role: 'user',
  id: overrides.id ?? 'u1',
  time: overrides.time ?? 1000,
  content: overrides.content ?? 'hi',
  attachments: overrides.attachments ?? [],
});

const a = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  id: overrides.id ?? 'a1',
  time: overrides.time ?? 2000,
  think: overrides.think ?? '',
  content: overrides.content ?? '',
  tool_calls: overrides.tool_calls ?? [],
  outcome: overrides.outcome,
  model: overrides.model,
  usage: overrides.usage,
});

describe('messageWire.dehydrate', () => {
  it('user 无 attachments 时省略键名', () => {
    const lines = dehydrate([u({ content: 'hello' })]);
    expect(lines).toHaveLength(1);
    const line = lines[0] as PersistedUserMessage;
    expect(line).toEqual({ role: 'user', id: 'u1', time: 1000, content: 'hello' });
    expect('attachments' in line).toBe(false);
  });

  it('user 有 attachments 时保留', () => {
    const lines = dehydrate([
      u({
        attachments: [
          {
            kind: 'image',
            fileName: 'a.png',
            fileSize: 10,
            mimeType: 'image/png',
            source: { kind: 'dataUrl', data: 'AAAA' },
          },
        ],
      }),
    ]);
    expect((lines[0] as PersistedUserMessage).attachments).toHaveLength(1);
  });

  it('assistant 空 tool_calls / 空 outcome 时省略键名', () => {
    const lines = dehydrate([a({ content: 'sure', think: '...' })]);
    const line = lines[0] as PersistedAssistantMessage;
    expect(line).toEqual({
      role: 'assistant',
      id: 'a1',
      time: 2000,
      think: '...',
      content: 'sure',
    });
    expect('tool_calls' in line).toBe(false);
    expect('outcome' in line).toBe(false);
    expect('model' in line).toBe(false);
    expect('usage' in line).toBe(false);
  });

  it('assistant 带 tool_calls 时,每个有 response 的 ToolCall 紧跟一条 tool_res 行', () => {
    const lines = dehydrate([
      a({
        tool_calls: [
          { id: 't1', name: 'read', time: 2001, args: { path: 'x' }, response: { time: 2010, status: 'success', result: 'ok', images: [] } },
          { id: 't2', name: 'bash', time: 2002, args: { cmd: 'ls' } },          // 无 response：不产 tool_res 行
          { id: 't3', name: 'write', time: 2003, args: {}, response: { time: 2020, status: 'fail', result: 'oops', images: [] } },
        ],
      }),
    ]);
    // assistant + 2 tool_res (t1, t3) —— t2 无 response 不输出
    expect(lines.map((l) => l.role)).toEqual(['assistant', 'tool_res', 'tool_res']);
    expect((lines[1] as PersistedToolResponse).id).toBe('t1');
    expect((lines[2] as PersistedToolResponse).id).toBe('t3');
    expect((lines[2] as PersistedToolResponse).status).toBe('fail');
    // assistant 行内 tool_calls 不含 response 字段
    const assistantLine = lines[0] as PersistedAssistantMessage;
    expect(assistantLine.tool_calls?.[0]).not.toHaveProperty('response');
  });
});

describe('messageWire.rehydrate', () => {
  it('user / assistant 回填空数组默认值', () => {
    const lines: PersistedJsonLine[] = [
      { role: 'user', id: 'u1', time: 1, content: 'hi' },                       // 无 attachments
      { role: 'assistant', id: 'a1', time: 2, think: '', content: 'yo' },       // 无 tool_calls
    ];
    const { messages, orphanResponses } = rehydrate(lines);
    expect(orphanResponses).toEqual([]);
    expect(messages).toHaveLength(2);
    expect((messages[0] as UserMessage).attachments).toEqual([]);
    expect((messages[1] as AssistantMessage).tool_calls).toEqual([]);
  });

  it('tool_res 行折回到对应 ToolCall.response', () => {
    const lines: PersistedJsonLine[] = [
      {
        role: 'assistant', id: 'a1', time: 2, think: '', content: '',
        tool_calls: [
          { id: 't1', name: 'read', time: 2, args: {} },
          { id: 't2', name: 'bash', time: 2, args: {} },
        ],
      },
      { role: 'tool_res', id: 't1', time: 3, status: 'success', result: 'A' },
      { role: 'tool_res', id: 't2', time: 4, status: 'fail', result: 'E' },
    ];
    const { messages, orphanResponses } = rehydrate(lines);
    expect(orphanResponses).toEqual([]);
    const am = messages[0] as AssistantMessage;
    expect(am.tool_calls[0].response).toEqual({ time: 3, status: 'success', result: 'A', images: [] });
    expect(am.tool_calls[1].response).toEqual({ time: 4, status: 'fail', result: 'E', images: [] });
  });

  it('同 id 多条 tool_res，最新一条胜出 (重试历史不入 Domain)', () => {
    const lines: PersistedJsonLine[] = [
      {
        role: 'assistant', id: 'a1', time: 2, think: '', content: '',
        tool_calls: [{ id: 't1', name: 'read', time: 2, args: {} }],
      },
      { role: 'tool_res', id: 't1', time: 3, status: 'fail', result: 'oops' },
      { role: 'tool_res', id: 't1', time: 4, status: 'success', result: 'retry-ok' },
    ];
    const { messages } = rehydrate(lines);
    const am = messages[0] as AssistantMessage;
    expect(am.tool_calls[0].response).toEqual({ time: 4, status: 'success', result: 'retry-ok', images: [] });
  });

  it('找不到匹配 ToolCall 的 tool_res 进 orphan 而不抛错', () => {
    const lines: PersistedJsonLine[] = [
      { role: 'user', id: 'u1', time: 1, content: 'hi' },
      { role: 'tool_res', id: 'ghost', time: 2, status: 'success', result: '?' },
    ];
    const { messages, orphanResponses } = rehydrate(lines);
    expect(messages).toHaveLength(1);
    expect(orphanResponses).toHaveLength(1);
    expect(orphanResponses[0].id).toBe('ghost');
  });
});

describe('messageWire.rehydrate ∘ dehydrate 双向 round-trip', () => {
  it('完整一轮 (user → assistant w/ tool_calls + responses)', () => {
    const original: Message[] = [
      u({ id: 'u1', time: 1, content: 'hi', attachments: [
        {
          kind: 'image', fileName: 'a.png', fileSize: 1, mimeType: 'image/png',
          source: { kind: 'dataUrl', data: 'AAAA' },
        },
      ] }),
      a({
        id: 'a1', time: 2, think: 'reasoning', content: 'response',
        tool_calls: [
          { id: 't1', name: 'read', time: 3, args: { path: '/x' }, response: { time: 4, status: 'success', result: 'data', images: [] } },
          { id: 't2', name: 'bash', time: 3, args: { cmd: 'ls' }, response: { time: 5, status: 'fail', result: 'denied', images: [] } },
        ],
        outcome: { kind: 'stop' },
        model: 'pi-1',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
      u({ id: 'u2', time: 6, content: 'follow up' }),
    ];

    const lines = dehydrate(original);
    const { messages: restored, orphanResponses } = rehydrate(lines);

    expect(orphanResponses).toEqual([]);
    expect(restored).toEqual(original);
  });

  it('user 无 attachments / assistant 无 tool_calls 的极简形态也正确 round-trip', () => {
    const original: Message[] = [u({ content: 'hi' }), a({ content: 'yo' })];
    const lines = dehydrate(original);
    const { messages: restored } = rehydrate(lines);
    expect(restored).toEqual(original);
  });

  it('tool response 的 images 字段双向 round-trip(被读取的图片随 tool_res 落盘)', () => {
    const original: Message[] = [
      a({
        id: 'a1', time: 2, content: '',
        tool_calls: [
          {
            id: 't1', name: 'read', time: 3, args: { path: 'local://uploads/shot.png' },
            response: {
              time: 4, status: 'success', result: '{"url":"local://uploads/shot.png"}',
              images: [{ data: 'QkFTRTY0', mimeType: 'image/png' }],
            },
          },
        ],
        outcome: { kind: 'stop' },
      }),
    ];
    const lines = dehydrate(original);
    const { messages: restored } = rehydrate(lines);
    expect(restored).toEqual(original);
  });
});
