/**
 * messageBridge 双向翻译单测。
 * 不依赖 pi-ai 真实运行;只构造 PiAssistantMessage / Domain Message 字面量验证翻译契约。
 */
import { describe, expect, it } from 'vitest';

import { fromPiAssistantMessage, toPiContext } from '../messageBridge';
import type {
  AssistantMessage,
  Message,
  ToolCall,
  UserMessage,
} from '@shared/types/message';
import type {
  AssistantMessage as PiAssistantMessage,
  Tool as PiTool,
} from '@earendil-works/pi-ai';

const piAssistant = (overrides: Partial<PiAssistantMessage> = {}): PiAssistantMessage => ({
  role: 'assistant',
  content: overrides.content ?? [],
  api: 'openai',
  provider: 'openai',
  model: overrides.model ?? 'gpt-x',
  usage: overrides.usage ?? { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: overrides.stopReason ?? 'stop',
  timestamp: overrides.timestamp ?? 12345,
  responseId: overrides.responseId,
  errorMessage: overrides.errorMessage,
});

const u = (overrides: Partial<UserMessage> = {}): UserMessage => ({
  role: 'user',
  id: overrides.id ?? 'u1',
  time: overrides.time ?? 100,
  content: overrides.content ?? '',
  attachments: overrides.attachments ?? [],
});

const a = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  id: overrides.id ?? 'a1',
  time: overrides.time ?? 200,
  think: overrides.think ?? '',
  content: overrides.content ?? '',
  tool_calls: overrides.tool_calls ?? [],
  outcome: overrides.outcome,
  model: overrides.model,
  usage: overrides.usage,
});

const tc = (id: string, withResponse: 'success' | 'fail' | false = false): ToolCall => ({
  id,
  name: 'read',
  time: 1,
  args: { path: `/x/${id}` },
  ...(withResponse
    ? { response: { time: 2, status: withResponse, result: `R-${id}`, images: [] } }
    : {}),
});

// ───────────────────────────────────────────────────────────────────────────
// 入境
// ───────────────────────────────────────────────────────────────────────────

describe('fromPiAssistantMessage 入境', () => {
  it('多 thinking part 聚合成单串 think', () => {
    const pi = piAssistant({
      content: [
        { type: 'thinking', thinking: 'aaa' },
        { type: 'thinking', thinking: 'bbb' },
      ],
      responseId: 'r1',
    });
    const out = fromPiAssistantMessage(pi);
    expect(out.think).toBe('aaabbb');
    expect(out.content).toBe('');
    expect(out.tool_calls).toEqual([]);
  });

  it('多 text part 聚合成单串 content', () => {
    const pi = piAssistant({
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ],
      responseId: 'r2',
    });
    const out = fromPiAssistantMessage(pi);
    expect(out.content).toBe('hello world');
  });

  it('toolCall part 拍平到 tool_calls 数组', () => {
    const pi = piAssistant({
      content: [
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: 'let me check' },
        { type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/x' } },
        { type: 'toolCall', id: 't2', name: 'write', arguments: { path: '/y', body: 'hi' } },
      ],
      responseId: 'r3',
      stopReason: 'toolUse',
    });
    const out = fromPiAssistantMessage(pi);
    expect(out.think).toBe('plan');
    expect(out.content).toBe('let me check');
    expect(out.tool_calls).toHaveLength(2);
    expect(out.tool_calls[0]).toMatchObject({ id: 't1', name: 'read', args: { path: '/x' } });
    expect(out.tool_calls[1]).toMatchObject({ id: 't2', name: 'write', args: { path: '/y', body: 'hi' } });
    // 默认 stop —— toolUse 不进 outcome,通过 tool_calls.length 表达
    expect(out.outcome).toBeUndefined();
  });

  it('stopReason=aborted 时 outcome.kind=aborted, partial 跟内容非空成正比', () => {
    const empty = fromPiAssistantMessage(piAssistant({ content: [], stopReason: 'aborted' }));
    expect(empty.outcome).toEqual({ kind: 'aborted', partial: false });

    const withText = fromPiAssistantMessage(
      piAssistant({ content: [{ type: 'text', text: 'half' }], stopReason: 'aborted' }),
    );
    expect(withText.outcome).toEqual({ kind: 'aborted', partial: true });
  });

  it('stopReason=error 时 outcome.kind=error 透传 message', () => {
    const out = fromPiAssistantMessage(
      piAssistant({ content: [], stopReason: 'error', errorMessage: 'boom' }),
    );
    expect(out.outcome).toEqual({ kind: 'error', message: 'boom' });
  });

  it('error message 含 overflow 关键字 → category=overflow', () => {
    const out = fromPiAssistantMessage(
      piAssistant({ content: [], stopReason: 'error', errorMessage: 'context length exceeded' }),
    );
    expect(out.outcome).toEqual({
      kind: 'error',
      message: 'context length exceeded',
      category: 'overflow',
    });
  });

  it('responseId 缺省时生成 id', () => {
    const out = fromPiAssistantMessage(piAssistant({ content: [], responseId: undefined }));
    expect(out.id).toMatch(/^msg_/);
  });

  it('usage 转 Domain (in / out / cache / total)', () => {
    const out = fromPiAssistantMessage(
      piAssistant({
        content: [],
        usage: { input: 100, output: 50, cacheRead: 30, cacheWrite: 20, totalTokens: 200, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }),
    );
    expect(out.usage).toEqual({ in: 100, out: 50, cache: [30, 20], total: 200 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 出境
// ───────────────────────────────────────────────────────────────────────────

describe('toPiContext 出境', () => {
  const tools: PiTool[] = [];

  it('first user message receives its stable sent-time reminder', () => {
    const ctx = toPiContext([u({ content: 'hi' })], 'sys', tools);
    expect(ctx.systemPrompt).toBe('sys');
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]).toMatchObject({
      role: 'user',
      timestamp: 100,
      content: [
        { type: 'text', text: 'hi' },
        { type: 'text', text: expect.stringContaining('This user message was sent at') },
      ],
    });
  });

  it('adds a transient reminder only at the request-message tail', () => {
    const reminder = '<system-reminder>Turn 2 of 5</system-reminder>';
    const ctx = toPiContext([u({ content: 'hi' })], 'stable system prompt', tools, { transientReminder: reminder });

    expect(ctx.systemPrompt).toBe('stable system prompt');
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'text', text: expect.stringContaining('This user message was sent at') },
      ],
    });
    expect(ctx.messages[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: reminder }],
    });
  });

  it('adds the first user message time as a stable reminder', () => {
    const messages: Message[] = [
      u({ id: 'u_first', time: 500, content: 'first message' }),
      a({ content: 'assistant response' }),
      u({ id: 'u_second', time: 600, content: 'second message' }),
    ];

    const first = toPiContext(messages, 'stable system prompt', tools);
    const second = toPiContext(messages, 'stable system prompt', tools);

    expect(second).toEqual(first);
    const firstUser = first.messages[0] as { content: Array<{ type: string; text?: string }> };
    const secondUser = first.messages[2] as { content: Array<{ type: string; text?: string }> };
    expect(firstUser.content).toContainEqual({ type: 'text', text: 'first message' });
    expect(firstUser.content[1].text).toContain('This user message was sent at');
    expect(firstUser.content[1].text).toContain('not the current time');
    expect(secondUser.content).toEqual([{ type: 'text', text: 'second message' }]);
  });


  it('user 带 image attachment → text + image content', () => {
    const ctx = toPiContext(
      [
        u({
          content: 'look at this',
          attachments: [
            {
              kind: 'image',
              fileName: 'a.png',
              fileSize: 1,
              mimeType: 'image/png',
              source: { kind: 'dataUrl', data: 'AAAA' },
            },
          ],
        }),
      ],
      '',
      tools,
    );
    expect(ctx.messages).toHaveLength(1);
    const user = ctx.messages[0];
    expect(user.role).toBe('user');
    expect((user as { content: unknown[] }).content).toHaveLength(3);
  });

  it('user 带 file attachment → annotation 拼到 text 段', () => {
    const ctx = toPiContext(
      [
        u({
          content: 'see file',
          attachments: [
            {
              kind: 'text',
              fileName: 'a.md',
              fileSize: 100,
              mimeType: 'text/markdown',
              fileUri: 'local:///a.md' as never,
              lines: 5,
            },
          ],
        }),
      ],
      '',
      tools,
    );
    const txt = (ctx.messages[0] as { content: { type: string; text: string }[] }).content[0].text;
    expect(txt).toContain('see file');
    expect(txt).toContain('Text Files List');
    expect(txt).toContain('a.md');
  });

  it('user 带 image+fileRef(大图)→ 不内联, 走 annotation 让模型 read', () => {
    const ctx = toPiContext(
      [
        u({
          content: 'big pic',
          attachments: [
            {
              kind: 'image',
              fileName: 'big.png',
              fileSize: 900000,
              mimeType: 'image/png',
              source: { kind: 'fileRef', uri: 'local://uploads/big.png' as never },
              width: 2000,
              height: 1500,
            },
          ],
        }),
      ],
      '',
      tools,
    );
    const content = (ctx.messages[0] as { content: { type: string; text?: string }[] }).content;
    // 两段 text:原 user/annotation + 固定时间 reminder;没有 image content。
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe('text');
    const txt = content[0].text ?? '';
    expect(txt).toContain('big pic');
    expect(txt).toContain('Image Files List');
    expect(txt).toContain('local://uploads/big.png');
    expect(txt).toContain('2000×1500');
  });


  it('assistant 1→N 展开: assistant 紧跟其 tool_calls 中已 response 的 toolResult', () => {
    const messages: Message[] = [
      u({ content: 'go' }),
      a({
        think: 'plan',
        content: 'done',
        tool_calls: [tc('t1', 'success'), tc('t2', 'fail'), tc('t3', false)],
        outcome: { kind: 'stop' },
      }),
    ];
    const ctx = toPiContext(messages, '', tools);
    // 顺序: user, assistant, toolResult(t1), toolResult(t2);t3 无 response 不输出
    expect(ctx.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult', 'toolResult']);
    const tr1 = ctx.messages[2] as { toolCallId: string; isError: boolean };
    const tr2 = ctx.messages[3] as { toolCallId: string; isError: boolean };
    expect(tr1.toolCallId).toBe('t1');
    expect(tr1.isError).toBe(false);
    expect(tr2.toolCallId).toBe('t2');
    expect(tr2.isError).toBe(true);                                           // fail → isError=true
  });

  it('tool response 带 images → toolResult content 追加 ImageContent(text 在前,image 在后)', () => {
    const withImg: ToolCall = {
      id: 't1',
      name: 'read',
      time: 1,
      args: { path: 'local://uploads/shot.png' },
      response: {
        time: 2,
        status: 'success',
        result: '{"url":"local://uploads/shot.png"}',
        images: [{ data: 'QkFTRTY0', mimeType: 'image/png' }],
      },
    };
    const ctx = toPiContext([a({ tool_calls: [withImg] })], '', tools);
    const tr = ctx.messages[1] as { content: Array<{ type: string; data?: string; mimeType?: string }> };
    expect(tr.content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(tr.content[1].data).toBe('QkFTRTY0');
    expect(tr.content[1].mimeType).toBe('image/png');
  });

  it('assistant.content 携带 thinking + text + toolCall parts (按顺序: thinking 先, text 中, toolCall 末尾)', () => {
    const messages: Message[] = [
      a({
        think: 'reasoning',
        content: 'reply',
        tool_calls: [tc('t1')],
      }),
    ];
    const ctx = toPiContext(messages, '', tools);
    const assistant = ctx.messages[0] as { content: Array<{ type: string }> };
    expect(assistant.content.map((c) => c.type)).toEqual(['thinking', 'text', 'toolCall']);
  });

  it('assistant.outcome=error 时 stopReason=error, errorMessage 透传到 pi', () => {
    const ctx = toPiContext(
      [a({ content: '', outcome: { kind: 'error', message: 'rate limited' } })],
      '',
      tools,
    );
    const piMsg = ctx.messages[0] as { stopReason: string; errorMessage?: string };
    expect(piMsg.stopReason).toBe('error');
    expect(piMsg.errorMessage).toBe('rate limited');
  });

  it('assistant outcome 缺省 + 有 tool_calls → stopReason=toolUse', () => {
    const ctx = toPiContext([a({ tool_calls: [tc('t1', 'success')] })], '', tools);
    expect((ctx.messages[0] as { stopReason: string }).stopReason).toBe('toolUse');
  });

  it('assistant outcome 缺省 + 无 tool_calls → stopReason=stop', () => {
    const ctx = toPiContext([a({ content: 'done' })], '', tools);
    expect((ctx.messages[0] as { stopReason: string }).stopReason).toBe('stop');
  });

  it('空 systemPrompt 不写入 ctx.systemPrompt', () => {
    const ctx = toPiContext([], '   ', tools);
    expect(ctx.systemPrompt).toBeUndefined();
  });

  it('tools 数组空时 ctx.tools 不写入', () => {
    const ctx = toPiContext([], 'sys', []);
    expect(ctx.tools).toBeUndefined();
  });
});
