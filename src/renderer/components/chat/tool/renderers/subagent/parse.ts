import { z } from 'zod';

const usageSchema = z.object({
  turns: z.number(),
  durationMs: z.number(),
  tokenUsage: z.object({
    in: z.number(),
    out: z.number(),
    cache: z.tuple([z.number(), z.number()]),
    total: z.number(),
  }).optional(),
});

const resultBaseSchema = z.object({
  subrunId: z.string(),
  delegateAgentId: z.string(),
  deliverables: z.array(z.string()),
  warnings: z.array(z.string()),
  usage: usageSchema,
});

export const subagentRunResultSchema = z.discriminatedUnion('status', [
  resultBaseSchema.extend({ status: z.literal('completed'), content: z.string() }),
  resultBaseSchema.extend({ status: z.literal('partial'), content: z.string(), incompleteReason: z.string() }),
  resultBaseSchema.extend({ status: z.literal('blocked'), reason: z.string(), content: z.string().optional() }),
  resultBaseSchema.extend({ status: z.literal('failed'), error: z.string() }),
  resultBaseSchema.extend({ status: z.literal('cancelled'), reason: z.string() }),
]);

const runOutcomeSchema = z.object({
  outcome: z.object({
    kind: z.literal('result'),
    result: subagentRunResultSchema,
  }),
});

const rejectedOutcomeSchema = z.object({
  outcome: z.object({
    kind: z.literal('rejected'),
    error: z.string(),
  }),
});

const readOnlyOutcomeSchema = z.object({
  outcome: z.object({ kind: z.literal('result') }),
});

export type SubagentRunResultView = z.infer<typeof subagentRunResultSchema>;

export type SubagentCommandOutcomeView =
  | z.infer<typeof runOutcomeSchema>['outcome']
  | z.infer<typeof rejectedOutcomeSchema>['outcome'];

function parseJson(content: string): object | null {
  try {
    const parsed = JSON.parse(content);
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function parseSubagentCommandOutcome(content: string): SubagentCommandOutcomeView | null {
  const parsed = parseJson(content);
  if (parsed === null) return null;

  const run = runOutcomeSchema.safeParse(parsed);
  if (run.success) return run.data.outcome;

  const rejected = rejectedOutcomeSchema.safeParse(parsed);
  return rejected.success ? rejected.data.outcome : null;
}

export function isReadOnlySubagentCommandResult(content: string): boolean {
  const parsed = parseJson(content);
  return parsed !== null && readOnlyOutcomeSchema.safeParse(parsed).success;
}
