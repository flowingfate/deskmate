import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  SubAgentRunResultByStatus,
  SubAgentRunRequest,
} from '../../../../shared/persist/types';
import { Subrun, type SubrunParent } from '../../../persist/subrun';

import {
  advanceRuntimeState,
  completeRuntimeState,
  createPendingRuntimeState,
  persistedRuntimeState,
  startRuntimeState,
} from '../runtimeState';
import { normalizeSubAgentContinuation, normalizeSubAgentRunRequest } from '../types';

const request: SubAgentRunRequest = {
  delegateAgentId: 'a_delegate',
  task: 'Inspect the report.',
  expectedOutput: 'A concise review.',
  context: { kind: 'isolated' },
  policy: { maxTurns: 25, timeoutMs: 60_000 },
};

let tmpRoot = '';

function parent(): SubrunParent {
  return {
    profileId: 'p_test',
    parentAgentId: 'a_parent',
    parentSessionId: 's_parent',
    subrunsDir: path.join(tmpRoot, 'subruns'),
  };
}

async function pendingSubrun(): Promise<Subrun> {
  const created = await Subrun.create(parent(), request);
  if (created.kind !== 'created') throw new Error('Expected a pending Subrun.');
  return created.subrun;
}

function completedResult(subrun: Subrun): SubAgentRunResultByStatus['completed'] {
  return {
    status: 'completed',
    subrunId: subrun.subrunId,
    delegateAgentId: subrun.delegateAgentId,
    content: 'Completed.',
    deliverables: [],
    warnings: [],
    usage: { turns: 2, durationMs: 200 },
  };
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'subrun-runtime-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

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

  it('normalizes a continuation message with the shared policy limits', () => {
    expect(normalizeSubAgentContinuation({
      message: '  Add rollout risks.  ',
      policy: { maxTurns: 500, timeoutMs: 9_000_000 },
    })).toEqual({
      message: 'Add rollout risks.',
      policy: { maxTurns: 100, timeoutMs: 3_600_000 },
    });
    expect(() => normalizeSubAgentContinuation({ message: ' ' })).toThrow('message must not be empty');
  });
});

describe('subagent runtime state', () => {
  it('tracks text progress, clears streaming text after another step, and never regresses turn', async () => {
    const running = startRuntimeState(createPendingRuntimeState(await pendingSubrun(), 'call_1'), 100);
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

  it('retains only the latest fifty progress steps', async () => {
    let state = startRuntimeState(createPendingRuntimeState(await pendingSubrun()), 100);
    for (let turn = 1; turn <= 51; turn += 1) {
      const next = advanceRuntimeState(state, { kind: 'turn_started', turn, timestamp: turn });
      if (!next) throw new Error('Expected a running state.');
      state = next;
    }

    expect(state.steps).toHaveLength(50);
    expect(state.steps[0]).toMatchObject({ turn: 2 });
    expect(state.steps[49]).toMatchObject({ turn: 51 });
  });

  it('derives matching terminal state directly from a persisted Subrun', async () => {
    const subrun = await pendingSubrun();
    const running = startRuntimeState(createPendingRuntimeState(subrun), 100);
    const result = completedResult(subrun);
    const terminal = completeRuntimeState(running, result, 300);
    if (!terminal) throw new Error('Expected terminal runtime state.');

    expect(completeRuntimeState(createPendingRuntimeState(subrun), result)).toBeNull();
    await subrun.start();
    await subrun.finish(result);
    const persisted = persistedRuntimeState(subrun);

    expect(terminal).toMatchObject({ status: 'completed', startedAt: 100, finishedAt: 300 });
    expect(persisted).toMatchObject({ status: 'completed', result: { status: 'completed' } });

    await subrun.continueConversation('Add rollout risks.', { maxTurns: 5, timeoutMs: 30_000 });
    await subrun.finish(result);
    const continued = persistedRuntimeState(subrun);
    expect(continued).toMatchObject({ maxTurns: 5, timeoutMs: 30_000 });
  });
});
