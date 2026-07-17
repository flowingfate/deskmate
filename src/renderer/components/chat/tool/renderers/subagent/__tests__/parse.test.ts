import { describe, expect, it } from 'vitest';

import {
  isReadOnlySubagentCommandResult,
  parseSubagentCommandOutcome,
} from '../parse';

const completedRun = JSON.stringify({
  outcome: {
    kind: 'result',
    result: {
      status: 'completed',
      subrunId: '001',
      delegateAgentId: 'a_delegate',
      content: 'Completed.',
      deliverables: ['local://workspace/report.txt'],
      warnings: [],
      usage: { turns: 2, durationMs: 100 },
    },
  },
});

describe('subagent renderer outcome parsing', () => {
  it('accepts only complete formal run results for run-card rendering', () => {
    expect(parseSubagentCommandOutcome(completedRun)).toMatchObject({
      kind: 'result',
      result: {
        status: 'completed',
        subrunId: '001',
        delegateAgentId: 'a_delegate',
      },
    });
    expect(parseSubagentCommandOutcome(JSON.stringify({
      outcome: {
        kind: 'result',
        result: {
          status: 'completed',
          subrunId: '001',
          delegateAgentId: 'a_delegate',
          content: 'Completed.',
          deliverables: [],
          warnings: [],
          usage: { turns: 1 },
        },
      },
    }))).toBeNull();
  });

  it('preserves explicit rejection but does not confuse read-only list output with a run', () => {
    expect(parseSubagentCommandOutcome(JSON.stringify({
      outcome: { kind: 'rejected', error: 'Delegate Agent is unavailable: a_missing.' },
    }))).toEqual({ kind: 'rejected', error: 'Delegate Agent is unavailable: a_missing.' });

    const listResult = JSON.stringify({
      outcome: { kind: 'result', available: [], unavailableIds: ['a_missing'] },
    });
    expect(parseSubagentCommandOutcome(listResult)).toBeNull();
    expect(isReadOnlySubagentCommandResult(listResult)).toBe(true);
    expect(isReadOnlySubagentCommandResult(completedRun)).toBe(true);
  });

  it('rejects malformed and non-object tool output', () => {
    expect(parseSubagentCommandOutcome('not json')).toBeNull();
    expect(parseSubagentCommandOutcome('[]')).toBeNull();
    expect(isReadOnlySubagentCommandResult('null')).toBe(false);
  });
});
