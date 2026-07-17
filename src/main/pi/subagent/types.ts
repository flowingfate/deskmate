import {
  type SubAgentRunContext,
  type SubAgentRunPolicy,
  type SubAgentRunRequest,
} from '@shared/persist/types';

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

  return {
    delegateAgentId,
    task,
    expectedOutput,
    context,
    policy: normalizeSubAgentRunPolicy(input.policy),
  };
}

export interface NormalizeSubAgentContinuationInput {
  message: string;
  policy?: Partial<SubAgentRunPolicy>;
}

export interface SubAgentContinuation {
  message: string;
  policy: SubAgentRunPolicy;
}

export function normalizeSubAgentContinuation(
  input: NormalizeSubAgentContinuationInput,
): SubAgentContinuation {
  const message = input.message.trim();
  if (!message) throw new Error('message must not be empty');
  return {
    message,
    policy: normalizeSubAgentRunPolicy(input.policy),
  };
}

function normalizeSubAgentRunPolicy(policy?: Partial<SubAgentRunPolicy>): SubAgentRunPolicy {
  const requestedMaxTurns = policy?.maxTurns;
  if (requestedMaxTurns !== undefined && (
    !Number.isInteger(requestedMaxTurns) || requestedMaxTurns <= 0
  )) {
    throw new Error('maxTurns must be a positive integer');
  }
  const maxTurns = Math.min(
    requestedMaxTurns ?? SUB_AGENT_RUN_POLICY_LIMITS.DEFAULT_MAX_TURNS,
    SUB_AGENT_RUN_POLICY_LIMITS.MAX_TURNS,
  );

  const requestedTimeoutMs = policy?.timeoutMs;
  if (requestedTimeoutMs !== undefined && (
    !Number.isInteger(requestedTimeoutMs) || requestedTimeoutMs <= 0
  )) {
    throw new Error('timeoutMs must be a positive integer');
  }
  const timeoutMs = Math.min(
    requestedTimeoutMs ?? maxTurns * MILLISECONDS_PER_TURN,
    SUB_AGENT_RUN_POLICY_LIMITS.MAX_TIMEOUT_MS,
  );

  return { maxTurns, timeoutMs };
}
