import type {
  SubAgentRunFailedResult,
  SubAgentRunResult,
  SubrunDataFile,
} from '@shared/persist/types';
import type {
  SubAgentPendingRuntimeState,
  SubAgentRunStep,
  SubAgentRunningRuntimeState,
  SubAgentRuntimeState,
} from '@shared/types/subAgentRunTypes';

const MAX_RUNTIME_STEPS = 50;

export function createPendingRuntimeState(
  data: SubrunDataFile,
  correlationId?: string,
): SubAgentPendingRuntimeState {
  return {
    profileId: data.profileId,
    parentAgentId: data.parentAgentId,
    parentSessionId: data.parentSessionId,
    subrunId: data.subrunId,
    delegateAgentId: data.delegateAgentId,
    correlationId,
    task: data.request.task,
    expectedOutput: data.request.expectedOutput,
    maxTurns: data.request.policy.maxTurns,
    timeoutMs: data.request.policy.timeoutMs,
    createdAt: Date.parse(data.createdAt),
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
    profileId: state.profileId,
    parentAgentId: state.parentAgentId,
    parentSessionId: state.parentSessionId,
    subrunId: state.subrunId,
    delegateAgentId: state.delegateAgentId,
    correlationId: state.correlationId,
    task: state.task,
    expectedOutput: state.expectedOutput,
    maxTurns: state.maxTurns,
    timeoutMs: state.timeoutMs,
    createdAt: state.createdAt,
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

export function persistedRuntimeState(data: SubrunDataFile): SubAgentRuntimeState {
  if (data.status === 'pending') return createPendingRuntimeState(data);

  const running = startRuntimeState(
    createPendingRuntimeState(data),
    Date.parse(data.startedAt),
  );
  if (data.status === 'running') return running;

  const terminal = completeRuntimeState(running, data.result, Date.parse(data.finishedAt));
  if (!terminal) throw new Error('Could not derive terminal Subrun runtime state.');
  return terminal;
}

export function interruptedResult(
  data: Extract<SubrunDataFile, { status: 'running' }>,
): SubAgentRunFailedResult {
  return {
    status: 'failed',
    subrunId: data.subrunId,
    delegateAgentId: data.delegateAgentId,
    deliverables: [],
    warnings: [],
    usage: {
      turns: 0,
      durationMs: Math.max(0, Date.now() - Date.parse(data.startedAt)),
    },
    error: 'Subrun interrupted by application restart.',
  };
}
