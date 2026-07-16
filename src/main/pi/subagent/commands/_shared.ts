import { COMMON_FLAGS } from '../../appcmd/_commonFlags';
import type { FlagSpec } from '../../appcmd/flags';
import type { AppCmdContext } from '../../appcmd/types';

export const SUBAGENT_HELP_FLAGS: readonly FlagSpec[] = COMMON_FLAGS.filter(
  (flag) => flag.name === 'help',
);

export function printSubAgentCommandOutcome(
  ctx: AppCmdContext,
  outcome: { kind: 'result' | 'rejected' },
): void {
  ctx.print(`${JSON.stringify({ outcome })}\n`);
  if (outcome.kind === 'rejected') ctx.setExitCode(1);
}
