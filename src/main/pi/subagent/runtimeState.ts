import type {
  SubAgentRunResult,
  SubAgentRunResultByStatus,
} from '@shared/persist/types';
import type { Subrun } from '@main/persist';
import type {
  SubAgentPendingRuntimeState,
  SubAgentRunStep,
  SubAgentRunningRuntimeState,
  SubAgentRuntimeState,
} from '@shared/types/subAgentRunTypes';

const MAX_RUNTIME_STEPS = 50;

export function createPendingRuntimeState(
  subrun: Subrun,
  correlationId?: string,
): SubAgentPendingRuntimeState {
  const request = subrun.request;
  const policy = subrun.execution.policy;
  return {
    parentAgentId: subrun.parentAgentId,
    parentSessionId: subrun.parentSessionId,
    subrunId: subrun.subrunId,
    delegateAgentId: subrun.delegateAgentId,
    correlationId,
    task: request.task,
    expectedOutput: request.expectedOutput,
    maxTurns: policy.maxTurns,
    timeoutMs: policy.timeoutMs,
    currentTurn: 0,
    steps: [],
    status: 'pending',
  };
}

export function startRuntimeState(
  pending: SubAgentPendingRuntimeState,
  startedAt = Date.now(),
): SubAgentRunningRuntimeState {
  return {
    ...pending,
    status: 'running',
    startedAt,
    lastTextSnippet: undefined,
    streamingText: undefined,
  };
}

export function advanceRuntimeState(
  state: SubAgentRuntimeState,
  step: SubAgentRunStep,
): SubAgentRunningRuntimeState | null {
  if (state.status !== 'running') return null;

  const steps = [...state.steps, step];
  if (steps.length > MAX_RUNTIME_STEPS) steps.splice(0, steps.length - MAX_RUNTIME_STEPS);
  return {
    ...state,
    currentTurn: Math.max(state.currentTurn, step.turn),
    steps,
    lastTextSnippet: step.kind === 'assistant_text' ? step.textSnippet : state.lastTextSnippet,
    streamingText: step.kind === 'assistant_text' ? step.textSnippet : undefined,
  };
}

export function completeRuntimeState(
  state: SubAgentRuntimeState,
  result: SubAgentRunResult,
  finishedAt = Date.now(),
): SubAgentRuntimeState | null {
  if (state.status !== 'running') return null;

  const base = {
    parentAgentId: state.parentAgentId,
    parentSessionId: state.parentSessionId,
    subrunId: state.subrunId,
    delegateAgentId: state.delegateAgentId,
    correlationId: state.correlationId,
    task: state.task,
    expectedOutput: state.expectedOutput,
    maxTurns: state.maxTurns,
    timeoutMs: state.timeoutMs,
    currentTurn: state.currentTurn,
    steps: state.steps,
    startedAt: state.startedAt,
    finishedAt,
  };

  switch (result.status) {
    case 'completed': return { ...base, status: 'completed', result };
    case 'partial': return { ...base, status: 'partial', result };
    case 'blocked': return { ...base, status: 'blocked', result };
    case 'failed': return { ...base, status: 'failed', result };
    case 'cancelled': return { ...base, status: 'cancelled', result };
  }
}

export function persistedRuntimeState(subrun: Subrun): SubAgentRuntimeState {
  if (subrun.status === 'pending') return createPendingRuntimeState(subrun);

  const running = startRuntimeState(
    createPendingRuntimeState(subrun),
    Date.parse(subrun.startedAt),
  );
  if (subrun.status === 'running') return running;

  const terminal = completeRuntimeState(running, subrun.result, Date.parse(subrun.finishedAt));
  if (!terminal) throw new Error('Could not derive terminal Subrun runtime state.');
  return terminal;
}

export function interruptedResult(subrun: Subrun): SubAgentRunResultByStatus['failed'] {
  if (subrun.status !== 'running') {
    throw new Error(`Cannot interrupt Subrun ${subrun.subrunId} from status ${subrun.status}.`);
  }
  return {
    status: 'failed',
    subrunId: subrun.subrunId,
    delegateAgentId: subrun.delegateAgentId,
    deliverables: [],
    warnings: [],
    usage: {
      turns: 0,
      durationMs: Math.max(0, Date.now() - Date.parse(subrun.startedAt)),
    },
    error: 'Subrun interrupted by application restart.',
  };
}
