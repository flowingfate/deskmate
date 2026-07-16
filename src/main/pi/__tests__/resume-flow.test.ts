/**
 * Resume 端到端测试 —— 把"上次没收尾的 turn"经 `BaseSession.restore()` 折回
 * pendingResume,验证 `planResume` 在 `turn.status === 'running'` 时被调用、
 * `messages` / `contextState` 完整还原。
 *
 * 与 `resume.test.ts` (planResume 纯函数 5 分支) 互补:本文件聚焦 BaseSession
 * 的 restore wiring —— 把 in-memory `PersistSessionLike` 当成"崩溃前的落盘
 * 状态"灌进去,断言 `pendingResume` 与 `messages` 重建的最终态。
 *
 * 注:`RegularSession.consumePendingResume` 把 runMissingTools / continueLoop /
 * startTurn 全部收敛回 `aborted` + idle (见 `session/regular.ts` consumePendingResume
 * 注释)。这是终态设计 —— 异常状态由 `loadChatSessionSnapshot` 的 `errorMessage`
 * 透到 UI,渲染端 ErrorBar + Retry 按钮让用户手动重试。本测试聚焦 restore →
 * planResume → pendingResume 的 wiring,不验证后续动作。
 */

import { describe, expect, it, vi } from 'vitest';

// 屏蔽 electron app —— RegularSession 构造路径会拉到 readAgentRuntimeConfig
// 等只在某些方法里需要 electron app 的工具,但 restore 自身不读 agent config。
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/deskmate-resume-test' },
}));

import { RegularSession, type PersistSessionLike } from '../session';
import type { Message, ToolResult } from '@shared/persist/types'
import type { PersistedToolResponse } from '@shared/persist/types';

// in-memory PersistSessionLike —— 不写盘,所有数据全在闭包字段里。
function makePersist(overrides: {
  messages?: Message[];
  turn?: { status: 'idle' | 'running'; startedAt?: number };
} = {}): PersistSessionLike & {
  appendedToolResponses: Array<{ id: string; result: ToolResult }>;
  rewriteCalls: number;
} {
  const messages: Message[] = overrides.messages ?? [];
  const config = {
    title: 'resume test',
    updatedAt: new Date(0).toISOString(),
    contextState: { compressions: [] as never[] },
    turn: overrides.turn,
  };
  const appendedToolResponses: Array<{ id: string; result: ToolResult }> = [];
  let rewriteCalls = 0;
  const orphanResponses: PersistedToolResponse[] = [];
  return {
    config,
    appendedToolResponses,
    get rewriteCalls() {
      return rewriteCalls;
    },
    async loadDomainMessages() {
      return { messages, orphanResponses };
    },
    appendDomainMessage(_m: Message) {
      // not used in restore-side tests
    },
    appendToolResponse(toolCallId: string, result: ToolResult) {
      appendedToolResponses.push({ id: toolCallId, result });
    },
    async rewriteMessages(_msgs) {
      rewriteCalls++;
    },
    async flushMessages() {},
    async persist() {},
  };
}

function userMsg(id: string, content: string): Message {
  return { role: 'user', id, time: 1, content, attachments: [] };
}

function assistantWithToolCalls(
  id: string,
  toolCalls: Array<{ id: string; withResponse: boolean }>,
): Message {
  return {
    role: 'assistant',
    id,
    time: 2,
    think: '',
    content: '',
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      name: 'read',
      time: 2,
      args: {},
      ...(tc.withResponse
        ? { response: { time: 3, status: 'success' as const, result: 'ok' } }
        : {}),
    })),
    outcome: { kind: 'stop' },
  };
}

describe('BaseSession.restore + planResume wiring', () => {
  it('turn.status=running with last assistant missing tool responses → runMissingTools', async () => {
    const persist = makePersist({
      messages: [
        userMsg('u1', 'do two things'),
        assistantWithToolCalls('a1', [
          { id: 'tc1', withResponse: true },
          { id: 'tc2', withResponse: false },
        ]),
      ],
      turn: { status: 'running', startedAt: 100 },
    });

    const session = new RegularSession('s1', 'p1', 'agent1', persist);
    // restoreTask 是 protected,通过等待公开 summary getter 确保 restore 完成。
    await session.getContextSummary();

    expect(session.pendingResume).toEqual({
      kind: 'runMissingTools',
      toolCallIds: ['tc2'],
    });
    expect(session.messages).toHaveLength(2);
  });

  it('turn.status=running with tail user → startTurn', async () => {
    const persist = makePersist({
      messages: [userMsg('u1', 'go')],
      turn: { status: 'running', startedAt: 100 },
    });

    const session = new RegularSession('s2', 'p1', 'agent1', persist);
    await session.getContextSummary();

    expect(session.pendingResume).toEqual({ kind: 'startTurn' });
  });

  it('turn.status=running with all tool responses present → continueLoop', async () => {
    const persist = makePersist({
      messages: [
        userMsg('u1', 'do it'),
        assistantWithToolCalls('a1', [{ id: 'tc1', withResponse: true }]),
      ],
      turn: { status: 'running', startedAt: 100 },
    });

    const session = new RegularSession('s3', 'p1', 'agent1', persist);
    await session.getContextSummary();

    expect(session.pendingResume).toEqual({ kind: 'continueLoop' });
  });

  it('turn.status=idle → markIdle (no resume)', async () => {
    const persist = makePersist({
      messages: [
        userMsg('u1', 'old turn'),
        assistantWithToolCalls('a1', [{ id: 'tc1', withResponse: true }]),
      ],
      turn: { status: 'idle' },
    });

    const session = new RegularSession('s4', 'p1', 'agent1', persist);
    await session.getContextSummary();

    expect(session.pendingResume).toEqual({ kind: 'markIdle' });
  });

  it('turn.status missing (legacy data) → markIdle', async () => {
    const persist = makePersist({
      messages: [userMsg('u1', 'hi')],
      turn: undefined,
    });

    const session = new RegularSession('s5', 'p1', 'agent1', persist);
    await session.getContextSummary();

    expect(session.pendingResume).toEqual({ kind: 'markIdle' });
  });

  it('assistant outcome=aborted → markTerminal even with turn.status=running', async () => {
    const persist = makePersist({
      messages: [
        userMsg('u1', 'do'),
        {
          role: 'assistant',
          id: 'a1',
          time: 2,
          think: '',
          content: 'partial',
          tool_calls: [],
          outcome: { kind: 'aborted', partial: true },
        },
      ],
      turn: { status: 'running', startedAt: 100 },
    });

    const session = new RegularSession('s6', 'p1', 'agent1', persist);
    await session.getContextSummary();

    expect(session.pendingResume).toEqual({
      kind: 'markTerminal',
      outcome: { kind: 'aborted', partial: true },
    });
  });

  it('contextState restored from persist config', async () => {
    const persist = makePersist({
      messages: [],
      turn: { status: 'idle' },
    });
    persist.config.contextState = {
      compressions: [],
      lastTokenUsage: {
        tokenCount: 1234,
        totalMessages: 0,
        contextMessages: 0,
        compressionRatio: 1.0,
      },
    };

    const session = new RegularSession('s7', 'p1', 'agent1', persist);
    await session.getContextSummary();

    expect(session.contextState.lastTokenUsage?.tokenCount).toBe(1234);
  });
});
