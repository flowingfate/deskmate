import {
  type SubAgentRunContext,
  type SubAgentRunPolicy,
  type SubAgentRunRequest,
} from '@shared/types/subAgentRunTypes';

const MILLISECONDS_PER_TURN = 60_000;

export const SUB_AGENT_RUN_POLICY_LIMITS = {
  DEFAULT_MAX_TURNS: 25,
  MAX_TURNS: 100,
  MAX_TIMEOUT_MS: 60 * MILLISECONDS_PER_TURN,
} as const;

export interface NormalizeSubAgentRunRequestInput {
  delegateAgentId: string;
  task: string;
  expectedOutput: string;
  context?: SubAgentRunContext;
  policy?: Partial<SubAgentRunPolicy>;
}

export function normalizeSubAgentRunRequest(
  input: NormalizeSubAgentRunRequestInput,
): SubAgentRunRequest {
  const delegateAgentId = input.delegateAgentId.trim();
  const task = input.task.trim();
  const expectedOutput = input.expectedOutput.trim();
  if (!delegateAgentId) throw new Error('delegateAgentId must not be empty');
  if (!task) throw new Error('task must not be empty');
  if (!expectedOutput) throw new Error('expectedOutput must not be empty');

  let context: SubAgentRunContext = { kind: 'isolated' };
  if (input.context?.kind === 'parent_summary') {
    const summary = input.context.summary.trim();
    if (!summary) throw new Error('context.summary must not be empty');
    context = { kind: 'parent_summary', summary };
  }

  const requestedMaxTurns = input.policy?.maxTurns;
  if (requestedMaxTurns !== undefined && (
    !Number.isInteger(requestedMaxTurns) || requestedMaxTurns <= 0
  )) {
    throw new Error('maxTurns must be a positive integer');
  }
  const maxTurns = Math.min(
    requestedMaxTurns ?? SUB_AGENT_RUN_POLICY_LIMITS.DEFAULT_MAX_TURNS,
    SUB_AGENT_RUN_POLICY_LIMITS.MAX_TURNS,
  );

  const requestedTimeoutMs = input.policy?.timeoutMs;
  if (requestedTimeoutMs !== undefined && (
    !Number.isInteger(requestedTimeoutMs) || requestedTimeoutMs <= 0
  )) {
    throw new Error('timeoutMs must be a positive integer');
  }
  const timeoutMs = Math.min(
    requestedTimeoutMs ?? maxTurns * MILLISECONDS_PER_TURN,
    SUB_AGENT_RUN_POLICY_LIMITS.MAX_TIMEOUT_MS,
  );

  return {
    delegateAgentId,
    task,
    expectedOutput,
    context,
    policy: { maxTurns, timeoutMs },
  };
}
