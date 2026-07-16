import type {
  SubAgentRunCancelledResult,
  SubAgentRunCompletedResult,
  SubAgentRunFailedResult,
  SubAgentRunPartialResult,
  SubAgentRunResult,
  SubAgentRunUsage,
  SubrunId,
  TokenUsage,
} from '@shared/persist/types';

import { parseInternalUrl } from '../internal-urls/parse';
import { jsonSchema } from '../tools/schema';
import type { LocalTool, ToolResult } from '../tools/types';

const SUBMIT_RESULT_NAME = 'submit_result';
const RESULT_NOT_SUBMITTED = 'result_not_submitted';

const SUBMIT_RESULT_PARAMETERS = jsonSchema({
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['completed', 'partial', 'blocked'],
      description: 'Formal outcome status. Only completed, partial, and blocked may be submitted.',
    },
    content: {
      type: 'string',
      description: 'Delivered content. Required for completed and partial; optional for blocked.',
    },
    incompleteReason: {
      type: 'string',
      description: 'Why output is incomplete. Required for partial.',
    },
    reason: {
      type: 'string',
      description: 'What is blocking the task. Required for blocked.',
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional non-fatal warnings for the parent agent.',
    },
    deliverables: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional local:// files created for the parent session.',
    },
  },
  required: ['status'],
  additionalProperties: false,
});

const SUBMIT_RESULT_DESCRIPTION = `Submit the formal result for this delegated run.

Call exactly once when the task is complete, incomplete, or blocked. Do not return the final answer only as normal assistant text.

- completed: requires content
- partial: requires content and incompleteReason
- blocked: requires reason; content is optional
- deliverables must be local:// URIs in the parent session

failed and cancelled are runtime outcomes and cannot be submitted.`;

export interface SubmitResultToolArgs {
  status?: string;
  content?: string;
  incompleteReason?: string;
  reason?: string;
  warnings?: string[];
  deliverables?: string[];
}

interface SubmittedResultBase {
  warnings: string[];
  deliverables: string[];
}

export interface SubmittedCompletedResult extends SubmittedResultBase {
  status: 'completed';
  content: string;
}

export interface SubmittedPartialResult extends SubmittedResultBase {
  status: 'partial';
  content: string;
  incompleteReason: string;
}

export interface SubmittedBlockedResult extends SubmittedResultBase {
  status: 'blocked';
  reason: string;
  content?: string;
}

export type SubmittedResult =
  | SubmittedCompletedResult
  | SubmittedPartialResult
  | SubmittedBlockedResult;

export interface SubmitAccepted {
  kind: 'submitted';
}

export interface SubmitRejected {
  kind: 'rejected';
  error: string;
}

export type SubmitResultOutcome = SubmitAccepted | SubmitRejected;

export interface FormalResultMetadata {
  subrunId: SubrunId;
  delegateAgentId: string;
  usage: SubAgentRunUsage;
  toolDeliverables: readonly string[];
}

export interface BuildFormalResultInput {
  metadata: FormalResultMetadata;
  submitted: SubmittedResult | SystemResult;
}

export interface SystemPartialResult {
  status: 'partial';
  content: string;
  incompleteReason: string;
  warnings?: string[];
}

export interface SystemFailedResult {
  status: 'failed';
  error: string;
  warnings?: string[];
}

export interface SystemCancelledResult {
  status: 'cancelled';
  reason: string;
  warnings?: string[];
}

export type SystemResult = SystemPartialResult | SystemFailedResult | SystemCancelledResult;

export interface FormalResultBuilt {
  kind: 'result';
  result: SubAgentRunResult;
}

export interface FormalResultInvalidMetadata {
  kind: 'invalid_metadata';
  error: string;
}

export type BuildFormalResultOutcome = FormalResultBuilt | FormalResultInvalidMetadata;

export interface MissingSubmitInput {
  reminderSent: boolean;
  assistantContent: string;
  hasAvailableTools: boolean;
  reachedMaxTurns: boolean;
}

export interface MissingSubmitReminder {
  kind: 'remind';
  reminder: string;
}

export interface MissingSubmitPartial {
  kind: 'partial';
  submitted: SystemPartialResult;
}

export interface MissingSubmitFailed {
  kind: 'failed';
  submitted: SystemFailedResult;
}

export type MissingSubmitDecision =
  | MissingSubmitReminder
  | MissingSubmitPartial
  | MissingSubmitFailed;

/** 每个 delegated run 独享；首份合法模型结果是唯一事实源。 */
export class SubmitResultController {
  private submittedResult: SubmittedResult | undefined;

  public submit(input: SubmitResultToolArgs): SubmitResultOutcome {
    if (this.submittedResult) {
      return { kind: 'rejected', error: 'submit_result has already been called for this run.' };
    }

    const normalized = normalizeSubmittedResult(input);
    if (normalized.kind === 'rejected') return normalized;

    this.submittedResult = normalized.submitted;
    return { kind: 'submitted' };
  }

  public get submitted(): SubmittedResult | undefined {
    return this.submittedResult;
  }
}

/** 创建只挂在单个 delegated catalog 上的 LocalTool，绝不注册全局 registry。 */
export function createSubmitResultTool(controller: SubmitResultController): LocalTool {
  return {
    spec: {
      name: SUBMIT_RESULT_NAME,
      description: SUBMIT_RESULT_DESCRIPTION,
      parameters: SUBMIT_RESULT_PARAMETERS,
    },
    async handler(args: SubmitResultToolArgs): Promise<ToolResult> {
      const outcome = controller.submit(args);
      if (outcome.kind === 'rejected') return { ok: false, error: outcome.error };
      return { ok: true, content: JSON.stringify({ status: 'submitted' }) };
    },
  };
}

/** 把已验证的模型提交或 runtime system outcome 加上可信 runtime metadata。 */
export function buildFormalResult(input: BuildFormalResultInput): BuildFormalResultOutcome {
  const usage = normalizeUsage(input.metadata.usage);
  if (!usage) return { kind: 'invalid_metadata', error: 'Subrun usage must contain finite non-negative integers.' };

  const toolDeliverables = normalizeDeliverables(input.metadata.toolDeliverables);
  if (toolDeliverables.kind === 'rejected') {
    return { kind: 'invalid_metadata', error: `Invalid tool deliverables: ${toolDeliverables.error}` };
  }
  const warnings = normalizeStrings(input.submitted.warnings, 'warnings');
  if (warnings.kind === 'rejected') {
    return { kind: 'invalid_metadata', error: `Invalid result warnings: ${warnings.error}` };
  }
  const submittedDeliverables = 'deliverables' in input.submitted
    ? input.submitted.deliverables
    : [];

  const metadata = {
    subrunId: input.metadata.subrunId,
    delegateAgentId: input.metadata.delegateAgentId,
    usage,
    deliverables: mergeStable(toolDeliverables.values, submittedDeliverables),
    warnings: warnings.values,
  };

  switch (input.submitted.status) {
    case 'completed':
      return {
        kind: 'result',
        result: { ...metadata, status: 'completed', content: input.submitted.content } satisfies SubAgentRunCompletedResult,
      };
    case 'partial':
      return {
        kind: 'result',
        result: {
          ...metadata,
          status: 'partial',
          content: input.submitted.content,
          incompleteReason: input.submitted.incompleteReason,
        } satisfies SubAgentRunPartialResult,
      };
    case 'blocked':
      return {
        kind: 'result',
        result: {
          ...metadata,
          status: 'blocked',
          reason: input.submitted.reason,
          content: input.submitted.content,
        },
      };
    case 'failed':
      return {
        kind: 'result',
        result: { ...metadata, status: 'failed', error: input.submitted.error } satisfies SubAgentRunFailedResult,
      };
    case 'cancelled':
      return {
        kind: 'result',
        result: { ...metadata, status: 'cancelled', reason: input.submitted.reason } satisfies SubAgentRunCancelledResult,
      };
  }
}

/**
 * 在 session 之外固定“模型停止但没有正式提交”的规则。取消、超时和异常由 runtime
 * 先行处理，不能借这条 fallback 改写它们。
 */
export function decideMissingSubmit(input: MissingSubmitInput): MissingSubmitDecision {
  if (!input.reminderSent && input.hasAvailableTools && !input.reachedMaxTurns) {
    return {
      kind: 'remind',
      reminder: '<system-reminder>Before ending this delegated run, call submit_result with the formal outcome.</system-reminder>',
    };
  }

  const content = input.assistantContent.trim();
  if (content) {
    return {
      kind: 'partial',
      submitted: {
        status: 'partial',
        content,
        incompleteReason: RESULT_NOT_SUBMITTED,
      },
    };
  }

  return {
    kind: 'failed',
    submitted: { status: 'failed', error: RESULT_NOT_SUBMITTED },
  };
}

interface SubmittedResultNormalized {
  kind: 'submitted';
  submitted: SubmittedResult;
}

function normalizeSubmittedResult(input: SubmitResultToolArgs): SubmittedResultNormalized | SubmitRejected {
  const warnings = normalizeStrings(input.warnings, 'warnings');
  if (warnings.kind === 'rejected') return warnings;

  const deliverables = normalizeDeliverables(input.deliverables);
  if (deliverables.kind === 'rejected') return deliverables;

  switch (input.status) {
    case 'completed': {
      const content = requiredText(input.content);
      if (!content) return { kind: 'rejected', error: 'completed submit_result requires non-empty content.' };
      return { kind: 'submitted', submitted: { status: 'completed', content, warnings: warnings.values, deliverables: deliverables.values } };
    }
    case 'partial': {
      const content = requiredText(input.content);
      const incompleteReason = requiredText(input.incompleteReason);
      if (!content || !incompleteReason) {
        return { kind: 'rejected', error: 'partial submit_result requires non-empty content and incompleteReason.' };
      }
      return {
        kind: 'submitted',
        submitted: { status: 'partial', content, incompleteReason, warnings: warnings.values, deliverables: deliverables.values },
      };
    }
    case 'blocked': {
      const reason = requiredText(input.reason);
      if (!reason) return { kind: 'rejected', error: 'blocked submit_result requires a non-empty reason.' };
      const content = optionalText(input.content, 'content');
      if (content.kind === 'rejected') return content;
      return {
        kind: 'submitted',
        submitted: {
          status: 'blocked',
          reason,
          content: content.value,
          warnings: warnings.values,
          deliverables: deliverables.values,
        },
      };
    }
    default:
      return { kind: 'rejected', error: 'submit_result status must be completed, partial, or blocked.' };
  }
}

function normalizeUsage(usage: SubAgentRunUsage): SubAgentRunUsage | null {
  if (!isNonNegativeInteger(usage.turns) || !isNonNegativeInteger(usage.durationMs)) return null;
  if (usage.tokenUsage && !isTokenUsage(usage.tokenUsage)) return null;
  return usage;
}

function isTokenUsage(usage: TokenUsage): boolean {
  return isNonNegativeInteger(usage.in)
    && isNonNegativeInteger(usage.out)
    && isNonNegativeInteger(usage.cache[0])
    && isNonNegativeInteger(usage.cache[1])
    && isNonNegativeInteger(usage.total);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

interface NormalizedStrings {
  kind: 'normalized';
  values: string[];
}

function normalizeStrings(values: string[] | readonly string[] | undefined, label: string): NormalizedStrings | SubmitRejected {
  if (values !== undefined && !Array.isArray(values)) {
    return { kind: 'rejected', error: `${label} must be an array of strings.` };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    if (typeof value !== 'string') return { kind: 'rejected', error: `${label} must contain only strings.` };
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  return { kind: 'normalized', values: normalized };
}

function normalizeDeliverables(values: string[] | readonly string[] | undefined): NormalizedStrings | SubmitRejected {
  const normalized = normalizeStrings(values, 'deliverables');
  if (normalized.kind === 'rejected') return normalized;

  for (const uri of normalized.values) {
    if (!isParentLocalDeliverable(uri)) {
      return { kind: 'rejected', error: `deliverable must be a parent local:// URI: ${uri}` };
    }
  }
  return normalized;
}

function isParentLocalDeliverable(uri: string): boolean {
  try {
    const parsed = parseInternalUrl(uri);
    if (parsed.scheme !== 'local' || !parsed.host) return false;
    const segments = `${parsed.host}${parsed.rawPathname}`.split('/');
    return !segments.some((segment) => segment === '.' || segment === '..');
  } catch {
    return false;
  }
}

function requiredText(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

interface OptionalText {
  kind: 'value';
  value: string | undefined;
}

function optionalText(value: string | undefined, label: string): OptionalText | SubmitRejected {
  if (value === undefined) return { kind: 'value', value: undefined };
  if (typeof value !== 'string') return { kind: 'rejected', error: `${label} must be a string.` };
  const trimmed = value.trim();
  return { kind: 'value', value: trimmed || undefined };
}

function mergeStable(first: readonly string[], second: readonly string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...first, ...second]) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }
  return merged;
}
