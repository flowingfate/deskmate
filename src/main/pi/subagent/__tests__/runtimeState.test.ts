import { describe, expect, it } from 'vitest';

import type {
  PendingSubrunDataFile,
  SubAgentRunCompletedResult,
} from '../../../../shared/persist/types';

import {
  advanceRuntimeState,
  completeRuntimeState,
  createPendingRuntimeState,
  persistedRuntimeState,
  startRuntimeState,
} from '../runtimeState';
import { normalizeSubAgentRunRequest } from '../types';

function pendingData(): PendingSubrunDataFile {
  return {
    version: 1,
    kind: 'subrun',
    status: 'pending',
    subrunId: '001',
    profileId: 'p_test',
    parentAgentId: 'a_parent',
    parentSessionId: 's_parent',
    delegateAgentId: 'a_delegate',
    request: {
      delegateAgentId: 'a_delegate',
      task: 'Inspect the report.',
      expectedOutput: 'A concise review.',
      context: { kind: 'isolated' },
      policy: { maxTurns: 25, timeoutMs: 60_000 },
    },
    createdAt: '2026-07-17T00:00:00.000Z',
    session: {
      title: '',
      updatedAt: '2026-07-17T00:00:00.000Z',
      contextState: { compressions: [] },
    },
  };
}

function completedResult(): SubAgentRunCompletedResult {
  return {
    status: 'completed',
    subrunId: '001',
    delegateAgentId: 'a_delegate',
    content: 'Completed.',
    deliverables: [],
    warnings: [],
    usage: { turns: 2, durationMs: 200 },
  };
}

describe('normalizeSubAgentRunRequest', () => {
  it('trims required fields and derives the default timeout from default turns', () => {
    expect(normalizeSubAgentRunRequest({
      delegateAgentId: ' a_delegate ',
      task: ' inspect ',
      expectedOutput: ' review ',
    })).toEqual({
      delegateAgentId: 'a_delegate',
      task: 'inspect',
      expectedOutput: 'review',
      context: { kind: 'isolated' },
      policy: { maxTurns: 25, timeoutMs: 1_500_000 },
    });
  });

  it('keeps a trimmed parent summary and clamps independently supplied policy limits', () => {
    expect(normalizeSubAgentRunRequest({
      delegateAgentId: 'a_delegate',
      task: 'inspect',
      expectedOutput: 'review',
      context: { kind: 'parent_summary', summary: '  parent facts  ' },
      policy: { maxTurns: 500, timeoutMs: 9_000_000 },
    })).toEqual({
      delegateAgentId: 'a_delegate',
      task: 'inspect',
      expectedOutput: 'review',
      context: { kind: 'parent_summary', summary: 'parent facts' },
      policy: { maxTurns: 100, timeoutMs: 3_600_000 },
    });
  });

  it('rejects blank required values and non-positive policy values', () => {
    expect(() => normalizeSubAgentRunRequest({
      delegateAgentId: ' ',
      task: 'inspect',
      expectedOutput: 'review',
    })).toThrow('delegateAgentId must not be empty');
    expect(() => normalizeSubAgentRunRequest({
      delegateAgentId: 'a_delegate',
      task: 'inspect',
      expectedOutput: 'review',
      policy: { maxTurns: 0 },
    })).toThrow('maxTurns must be a positive integer');
    expect(() => normalizeSubAgentRunRequest({
      delegateAgentId: 'a_delegate',
      task: 'inspect',
      expectedOutput: 'review',
      context: { kind: 'parent_summary', summary: ' ' },
    })).toThrow('context.summary must not be empty');
  });
});

describe('subagent runtime state', () => {
  it('tracks text progress, clears streaming text after another step, and never regresses turn', () => {
    const running = startRuntimeState(createPendingRuntimeState(pendingData(), 'call_1'), 100);
    const afterText = advanceRuntimeState(running, {
      kind: 'assistant_text', turn: 2, timestamp: 110, textSnippet: 'working',
    });
    if (!afterText) throw new Error('Expected running state after text step.');

    const afterTool = advanceRuntimeState(afterText, {
      kind: 'tool_started', turn: 1, timestamp: 120, toolCallId: 'tool_1', toolName: 'read', argumentsSummary: '{}',
    });
    if (!afterTool) throw new Error('Expected running state after tool step.');

    expect(afterTool).toMatchObject({
      currentTurn: 2,
      lastTextSnippet: 'working',
      streamingText: undefined,
    });
  });

  it('retains only the latest fifty progress steps', () => {
    let state = startRuntimeState(createPendingRuntimeState(pendingData()), 100);
    for (let turn = 1; turn <= 51; turn += 1) {
      const next = advanceRuntimeState(state, { kind: 'turn_started', turn, timestamp: turn });
      if (!next) throw new Error('Expected a running state.');
      state = next;
    }

    expect(state.steps).toHaveLength(50);
    expect(state.steps[0]).toMatchObject({ turn: 2 });
    expect(state.steps[49]).toMatchObject({ turn: 51 });
  });

  it('derives matching terminal state from a persisted terminal data file', () => {
    const running = startRuntimeState(createPendingRuntimeState(pendingData()), 100);
    const terminal = completeRuntimeState(running, completedResult(), 300);
    if (!terminal) throw new Error('Expected terminal runtime state.');

    expect(completeRuntimeState(createPendingRuntimeState(pendingData()), completedResult())).toBeNull();
    const persisted = persistedRuntimeState({
      ...pendingData(),
      status: 'completed',
      startedAt: '2026-07-17T00:00:00.100Z',
      finishedAt: '2026-07-17T00:00:00.300Z',
      result: completedResult(),
    });

    expect(terminal).toMatchObject({ status: 'completed', startedAt: 100, finishedAt: 300 });
    expect(persisted).toMatchObject({ status: 'completed', result: { status: 'completed' } });
  });
});
