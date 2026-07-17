import { describe, expect, it } from 'vitest';

import type { FormalResultMetadata } from '../submitResult';
import {
  buildFormalResult,
  decideMissingSubmit,
  SubmitResultController,
} from '../submitResult';

const metadata: FormalResultMetadata = {
  subrunId: '001',
  delegateAgentId: 'a_delegate',
  usage: { turns: 2, durationMs: 300, tokenUsage: { in: 10, out: 20, cache: [0, 0], total: 30 } },
  toolDeliverables: ['local://workspace/tool-report.txt', 'local://workspace/final-report.txt'],
};

describe('SubmitResultController', () => {
  it('rejects invalid submissions without consuming the one allowed formal result', () => {
    const controller = new SubmitResultController();

    expect(controller.submit({
      status: 'completed',
      content: 'done',
      deliverables: ['local://workspace/../outside.txt'],
    })).toMatchObject({ kind: 'rejected' });
    expect(controller.submitted).toBeUndefined();

    expect(controller.submit({
      status: 'completed',
      content: '  completed work  ',
      warnings: [' first warning ', 'first warning'],
      deliverables: ['local://workspace/final-report.txt'],
    })).toEqual({ kind: 'submitted' });
    expect(controller.submit({ status: 'completed', content: 'replacement' })).toMatchObject({ kind: 'rejected' });
  });

  it('builds a completed result from the first submission and trusted metadata', () => {
    const controller = new SubmitResultController();
    controller.submit({
      status: 'completed',
      content: '  completed work  ',
      warnings: [' first warning ', 'first warning'],
      deliverables: ['local://workspace/final-report.txt'],
    });

    const submitted = controller.submitted;
    if (!submitted) throw new Error('Expected accepted submission.');

    const outcome = buildFormalResult({ metadata, submitted });
    if (outcome.kind !== 'result') throw new Error('Expected a formal result.');

    expect(outcome.result).toEqual({
      status: 'completed',
      subrunId: '001',
      delegateAgentId: 'a_delegate',
      content: 'completed work',
      warnings: ['first warning'],
      deliverables: ['local://workspace/tool-report.txt', 'local://workspace/final-report.txt'],
      usage: metadata.usage,
    });
  });
});

describe('decideMissingSubmit', () => {
  it('sends one reminder, then preserves content as partial or reports failure', () => {
    expect(decideMissingSubmit({
      reminderSent: false,
      assistantContent: 'draft',
      hasAvailableTools: true,
      reachedMaxTurns: false,
    })).toMatchObject({ kind: 'remind' });

    expect(decideMissingSubmit({
      reminderSent: true,
      assistantContent: '  draft  ',
      hasAvailableTools: true,
      reachedMaxTurns: false,
    })).toEqual({
      kind: 'partial',
      submitted: { status: 'partial', content: 'draft', incompleteReason: 'result_not_submitted' },
    });

    expect(decideMissingSubmit({
      reminderSent: false,
      assistantContent: '',
      hasAvailableTools: false,
      reachedMaxTurns: false,
    })).toEqual({
      kind: 'failed',
      submitted: { status: 'failed', error: 'result_not_submitted' },
    });
  });
});
