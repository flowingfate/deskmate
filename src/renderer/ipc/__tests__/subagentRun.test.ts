// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { SubAgentRunningRuntimeState } from '../../../shared/types/subAgentRunTypes';

import { matchesSubagentRunState } from '../subagentRun';

function runningState(): SubAgentRunningRuntimeState {
  return {
    status: 'running',
    profileId: 'p_one',
    parentAgentId: 'a_parent',
    parentSessionId: 's_parent',
    subrunId: '001',
    delegateAgentId: 'a_delegate',
    correlationId: 'call_1',
    task: 'Inspect the report.',
    expectedOutput: 'A concise review.',
    maxTurns: 25,
    timeoutMs: 60_000,
    startedAt: 20,
    currentTurn: 1,
    steps: [],
  };
}

describe('matchesSubagentRunState', () => {
  it('requires the complete profile, parent session, and correlation identity', () => {
    const state = runningState();
    const identity = {
      correlationId: 'call_1',
      profileId: 'p_one',
      parentAgentId: 'a_parent',
      parentSessionId: 's_parent',
      subrunId: '001',
    };

    expect(matchesSubagentRunState(state, identity)).toBe(true);
    expect(matchesSubagentRunState({ ...state, profileId: 'p_other' }, identity)).toBe(false);
    expect(matchesSubagentRunState({ ...state, parentSessionId: 's_other' }, identity)).toBe(false);
    expect(matchesSubagentRunState({ ...state, correlationId: 'call_other' }, identity)).toBe(false);
  });

  it('allows an unknown subrun during live admission but pins it once known', () => {
    const state = runningState();
    const pendingIdentity = {
      correlationId: 'call_1',
      profileId: 'p_one',
      parentAgentId: 'a_parent',
      parentSessionId: 's_parent',
      subrunId: undefined,
    };

    expect(matchesSubagentRunState(state, pendingIdentity)).toBe(true);
    expect(matchesSubagentRunState({ ...state, subrunId: '002' }, {
      ...pendingIdentity,
      subrunId: '001',
    })).toBe(false);
  });
});
