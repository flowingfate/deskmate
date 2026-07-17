import { COMMON_FLAGS } from '../../appcmd/_commonFlags';
import type { FlagSpec } from '../../appcmd/flags';
import type { AppCmdContext } from '../../appcmd/types';

export const SUBAGENT_HELP_FLAGS: readonly FlagSpec[] = COMMON_FLAGS.filter(
  (flag) => flag.name === 'help',
);

export interface ParsePositiveIntegerSuccess {
  ok: true;
  value: number | undefined;
}

export interface ParsePositiveIntegerFailure {
  ok: false;
  error: string;
}

export type ParsePositiveIntegerResult = ParsePositiveIntegerSuccess | ParsePositiveIntegerFailure;

export function parseOptionalPositiveIntegerFlag(
  value: string | boolean | readonly string[] | undefined,
  flagName: string,
): ParsePositiveIntegerResult {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    return { ok: false, error: `${flagName} must be a positive integer` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, error: `${flagName} must be a positive safe integer` };
  }
  return { ok: true, value: parsed };
}

export function printSubAgentCommandOutcome(
  ctx: AppCmdContext,
  outcome: { kind: 'result' | 'rejected' },
): void {
  ctx.print(`${JSON.stringify({ outcome })}\n`);
  if (outcome.kind === 'rejected') ctx.setExitCode(1);
}
