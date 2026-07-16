import { isHelp } from '../../appcmd/_commonFlags';
import { parseFlags, type FlagSpec } from '../../appcmd/flags';
import type { AppCommand, AppCmdContext } from '../../appcmd/types';
import type {
  SubAgentRunContext,
  SubAgentRunRequest,
} from '@shared/types/subAgentRunTypes';

import { normalizeSubAgentRunRequest } from '../types';
import {
  printSubAgentCommandOutcome,
  SUBAGENT_HELP_FLAGS,
} from './_shared';
import {
  type SubAgentCommandRunner,
  toSubAgentCommandScope,
} from './types';

interface ParseIntegerSuccess {
  ok: true;
  value: number | undefined;
}

interface ParseIntegerFailure {
  ok: false;
  error: string;
}

type ParseIntegerResult = ParseIntegerSuccess | ParseIntegerFailure;

interface RunArguments {
  delegateAgentId: string;
  task: string;
  expectedOutput: string;
  withParentSummary: boolean;
  maxTurns?: number;
  timeoutMs?: number;
}

interface RunArgumentsReady {
  kind: 'ready';
  value: RunArguments;
}

interface RunArgumentsHelp {
  kind: 'help';
}

interface RunArgumentsError {
  kind: 'error';
  error: string;
}

type ParseRunArgumentsResult = RunArgumentsReady | RunArgumentsHelp | RunArgumentsError;

interface RunRequestReady {
  ok: true;
  request: SubAgentRunRequest;
}

interface RunRequestError {
  ok: false;
  error: string;
  exitCode: 1 | 2;
}

type PrepareRunRequestResult = RunRequestReady | RunRequestError;

const HELP = `USAGE
  subagent run <agent-id> --task <text> --expect <text> [options]

DESCRIPTION
  Delegate one task to an Agent ID listed in the parent Agent's delegation
  section. --expect describes the concrete result the delegated Agent must
  return; it is required independently from --task.

  For independent tasks, call the subagent tool multiple times in the same
  assistant response, with one run command per tool call. The host executes
  those tool calls concurrently; do not look for a batch subcommand.

OPTIONS
  --task <text>             Required task description.
  --expect <text>           Required expected output or acceptance criteria.
  --with-parent-summary     Include a generated summary of the parent context.
  --max-turns <n>           Positive integer. Default 25; capped at 100.
  --timeout-seconds <n>     Positive integer. Defaults to max-turns x 60;
                            capped at 3600 seconds.
  --help, -h                Show this help.

EXAMPLE
  subagent run a_researcher --task "Compare the two APIs" \\
    --expect "A concise tradeoff table with source URLs"
`;

const FLAGS: FlagSpec[] = [
  ...SUBAGENT_HELP_FLAGS,
  { name: 'task', type: 'string' },
  { name: 'expect', type: 'string' },
  { name: 'with-parent-summary', type: 'boolean' },
  { name: 'max-turns', type: 'string' },
  { name: 'timeout-seconds', type: 'string' },
];

function parseOptionalPositiveIntegerFlag(
  value: string | boolean | readonly string[] | undefined,
  flagName: string,
): ParseIntegerResult {
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

function parseRunArguments(argv: readonly string[]): ParseRunArgumentsResult {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) return { kind: 'error', error: parsed.error };
  if (isHelp(parsed.flags)) return { kind: 'help' };
  if (parsed.positional.length !== 1) {
    return { kind: 'error', error: 'requires exactly one <agent-id>' };
  }

  const task = parsed.flags.task;
  const expectedOutput = parsed.flags.expect;
  if (typeof task !== 'string') {
    return { kind: 'error', error: 'missing required --task <text>' };
  }
  if (typeof expectedOutput !== 'string') {
    return { kind: 'error', error: 'missing required --expect <text>' };
  }

  const maxTurns = parseOptionalPositiveIntegerFlag(
    parsed.flags['max-turns'],
    '--max-turns',
  );
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
      delegateAgentId: parsed.positional[0],
      task,
      expectedOutput,
      withParentSummary: parsed.flags['with-parent-summary'] === true,
      maxTurns: maxTurns.value,
      timeoutMs,
    },
  };
}

async function prepareRunRequest(
  input: RunArguments,
  getParentContextSummary?: () => Promise<string>,
): Promise<PrepareRunRequestResult> {
  let context: SubAgentRunContext = { kind: 'isolated' };
  if (input.withParentSummary) {
    if (!getParentContextSummary) {
      return { ok: false, error: 'parent context summary is unavailable', exitCode: 1 };
    }
    try {
      context = {
        kind: 'parent_summary',
        summary: await getParentContextSummary(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `failed to load parent context summary: ${message}`,
        exitCode: 1,
      };
    }
  }

  try {
    return {
      ok: true,
      request: normalizeSubAgentRunRequest({
        delegateAgentId: input.delegateAgentId,
        task: input.task,
        expectedOutput: input.expectedOutput,
        context,
        policy: {
          maxTurns: input.maxTurns,
          timeoutMs: input.timeoutMs,
        },
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, exitCode: 2 };
  }
}

export function createRunCommand(runner: SubAgentCommandRunner): AppCommand {
  return {
    name: 'run',
    synopsis: 'Delegate one task; invoke multiple tool calls together for parallel work.',
    help: HELP,

    async run(argv: readonly string[], ctx: AppCmdContext): Promise<void> {
      const parsed = parseRunArguments(argv);
      if (parsed.kind === 'help') {
        ctx.print(HELP);
        return;
      }
      if (parsed.kind === 'error') {
        ctx.printErr(`subagent run: ${parsed.error}.\n`);
        ctx.setExitCode(2);
        return;
      }

      const prepared = await prepareRunRequest(parsed.value, ctx.getParentContextSummary);
      if (!prepared.ok) {
        ctx.printErr(`subagent run: ${prepared.error}.\n`);
        ctx.setExitCode(prepared.exitCode);
        return;
      }

      const outcome = await runner.run(toSubAgentCommandScope(ctx), prepared.request);
      printSubAgentCommandOutcome(ctx, outcome);
    },
  };
}
