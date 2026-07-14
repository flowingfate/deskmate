/**
 * planResume 纯函数单测 —— 覆盖策略矩阵的 5 个分支。
 */
import { describe, expect, it } from 'vitest';

import { planResume } from '../utils/resume';
import type { AssistantMessage,
Message,
ToolCall,
UserMessage, } from '@shared/persist/types'

const u = (id = 'u1'): UserMessage => ({
  role: 'user',
  id,
  time: 1,
  content: 'hi',
  attachments: [],
});

const tc = (id: string, withResponse = false): ToolCall => ({
  id,
  name: 'read',
  time: 2,
  args: {},
  ...(withResponse ? { response: { time: 3, status: 'success', result: 'ok' } } : {}),
});

const a = (overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: 'assistant',
  id: overrides.id ?? 'a1',
  time: overrides.time ?? 2,
  think: '',
  content: '',
  tool_calls: overrides.tool_calls ?? [],
  outcome: overrides.outcome,
});

describe('planResume', () => {
  it('空 messages → markIdle', () => {
    expect(planResume([])).toEqual({ kind: 'markIdle' });
  });

  it('尾部 user → startTurn', () => {
    expect(planResume([u()])).toEqual({ kind: 'startTurn' });
  });

  it('尾部 assistant stop 无 tool_calls → markIdle', () => {
    const m: Message[] = [u(), a({ outcome: { kind: 'stop' } })];
    expect(planResume(m)).toEqual({ kind: 'markIdle' });
  });

  it('尾部 assistant outcome 缺省（视作 stop）无 tool_calls → markIdle', () => {
    const m: Message[] = [u(), a({})];
    expect(planResume(m)).toEqual({ kind: 'markIdle' });
  });

  it('尾部 assistant stop 所有 tool_calls 有 response → continueLoop', () => {
    const m: Message[] = [
      u(),
      a({ outcome: { kind: 'stop' }, tool_calls: [tc('t1', true), tc('t2', true)] }),
    ];
    expect(planResume(m)).toEqual({ kind: 'continueLoop' });
  });

  it('尾部 assistant stop 有 tool_calls 缺 response → runMissingTools（按发现顺序）', () => {
    const m: Message[] = [
      u(),
      a({
        outcome: { kind: 'stop' },
        tool_calls: [tc('t1', true), tc('t2', false), tc('t3', false)],
      }),
    ];
    expect(planResume(m)).toEqual({
      kind: 'runMissingTools',
      toolCallIds: ['t2', 't3'],
    });
  });

  it('尾部 assistant aborted → markTerminal', () => {
    const m: Message[] = [u(), a({ outcome: { kind: 'aborted', partial: false } })];
    expect(planResume(m)).toEqual({
      kind: 'markTerminal',
      outcome: { kind: 'aborted', partial: false },
    });
  });

  it('尾部 assistant error → markTerminal 透传 outcome', () => {
    const m: Message[] = [
      u(),
      a({ outcome: { kind: 'error', message: 'rate limited', category: 'rateLimit' } }),
    ];
    expect(planResume(m)).toEqual({
      kind: 'markTerminal',
      outcome: { kind: 'error', message: 'rate limited', category: 'rateLimit' },
    });
  });

  it('尾部 assistant maxIter → markTerminal', () => {
    const m: Message[] = [u(), a({ outcome: { kind: 'maxIter' } })];
    expect(planResume(m)).toEqual({
      kind: 'markTerminal',
      outcome: { kind: 'maxIter' },
    });
  });

  it('多用户 + assistant 序列尾部按最后一条判定', () => {
    const m: Message[] = [
      u('u1'),
      a({ id: 'a1', outcome: { kind: 'stop' } }),
      u('u2'),
    ];
    // 尾部 user，无论前面的 assistant 状态如何
    expect(planResume(m)).toEqual({ kind: 'startTurn' });
  });
});
