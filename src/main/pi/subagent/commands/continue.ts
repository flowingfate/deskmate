import { isHelp } from '../../appcmd/_commonFlags';
import { parseFlags, type FlagSpec } from '../../appcmd/flags';
import type { AppCommand, AppCmdContext } from '../../appcmd/types';
import { isSubrunId, type SubrunId } from '@shared/persist/types';

import { normalizeSubAgentContinuation } from '../types';
import {
  parseOptionalPositiveIntegerFlag,
  printSubAgentCommandOutcome,
  SUBAGENT_HELP_FLAGS,
} from './_shared';
import type { SubAgentManager } from '../manager';
import { toSubAgentCommandScope } from './types';

interface ContinueArguments {
  subrunId: SubrunId;
  message: string;
  maxTurns?: number;
  timeoutMs?: number;
}

interface ParsedContinueArguments {
  kind: 'ready';
  value: ContinueArguments;
}

interface ContinueArgumentsHelp {
  kind: 'help';
}

interface ContinueArgumentsError {
  kind: 'error';
  error: string;
}

type ParseContinueArgumentsResult =
  | ParsedContinueArguments
  | ContinueArgumentsHelp
  | ContinueArgumentsError;

const HELP = `USAGE
  subagent continue <subrun-id> --message <text> [options]

DESCRIPTION
  Continue a terminal delegated conversation from its persisted transcript.
  The subrun ID is local to the current parent session. The delegated Agent is
  re-authorized before execution, and the new message receives its own formal
  result without creating another subrun reservation.

OPTIONS
  --message <text>          Required follow-up message.
  --max-turns <n>           Positive integer. Default 25; capped at 100.
  --timeout-seconds <n>     Positive integer. Defaults to max-turns x 60;
                            capped at 3600 seconds.
  --help, -h                Show this help.

EXAMPLE
  subagent continue 001 --message "Add the rollout and rollback risks"
`;

const FLAGS: FlagSpec[] = [
  ...SUBAGENT_HELP_FLAGS,
  { name: 'message', type: 'string' },
  { name: 'max-turns', type: 'string' },
  { name: 'timeout-seconds', type: 'string' },
];

function parseContinueArguments(argv: readonly string[]): ParseContinueArgumentsResult {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) return { kind: 'error', error: parsed.error };
  if (isHelp(parsed.flags)) return { kind: 'help' };
  if (parsed.positional.length !== 1 || !isSubrunId(parsed.positional[0])) {
    return { kind: 'error', error: 'requires exactly one valid <subrun-id>' };
  }

  const message = parsed.flags.message;
  if (typeof message !== 'string') {
    return { kind: 'error', error: 'missing required --message <text>' };
  }

  const maxTurns = parseOptionalPositiveIntegerFlag(parsed.flags['max-turns'], '--max-turns');
  if (!maxTurns.ok) return { kind: 'error', error: maxTurns.error };

  const timeoutSeconds = parseOptionalPositiveIntegerFlag(
    parsed.flags['timeout-seconds'],
    '--timeout-seconds',
  );
  if (!timeoutSeconds.ok) return { kind: 'error', error: timeoutSeconds.error };

  let timeoutMs: number | undefined;
  if (timeoutSeconds.value !== undefined) {
    timeoutMs = timeoutSeconds.value * 1_000;
    if (!Number.isSafeInteger(timeoutMs)) {
      return { kind: 'error', error: '--timeout-seconds is too large to convert safely' };
    }
  }

  return {
    kind: 'ready',
    value: {
      subrunId: parsed.positional[0],
      message,
      maxTurns: maxTurns.value,
      timeoutMs,
    },
  };
}

export function createContinueCommand(manager: SubAgentManager): AppCommand {
  return {
    name: 'continue',
    synopsis: 'Continue a terminal delegated conversation from its persisted transcript.',
    help: HELP,

    async run(argv: readonly string[], ctx: AppCmdContext): Promise<void> {
      const parsed = parseContinueArguments(argv);
      if (parsed.kind === 'help') {
        ctx.print(HELP);
        return;
      }
      if (parsed.kind === 'error') {
        ctx.printErr(`subagent continue: ${parsed.error}.\n`);
        ctx.setExitCode(2);
        return;
      }

      try {
        const execution = normalizeSubAgentContinuation({
          message: parsed.value.message,
          policy: {
            maxTurns: parsed.value.maxTurns,
            timeoutMs: parsed.value.timeoutMs,
          },
        });
        const outcome = await manager.continueRun(
          toSubAgentCommandScope(ctx),
          parsed.value.subrunId,
          execution,
        );
        printSubAgentCommandOutcome(ctx, outcome);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.printErr(`subagent continue: ${message}.\n`);
        ctx.setExitCode(2);
      }
    },
  };
}
