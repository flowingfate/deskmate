import { isHelp } from '../../appcmd/_commonFlags';
import { parseFlags, type FlagSpec } from '../../appcmd/flags';
import type { AppCommand, AppCmdContext } from '../../appcmd/types';

import {
  printSubAgentCommandOutcome,
  SUBAGENT_HELP_FLAGS,
} from './_shared';
import type { SubAgentManager } from '../manager';
import { toSubAgentCommandScope } from './types';

const HELP = `USAGE
  subagent describe <agent-id>

DESCRIPTION
  Show the safe capability summary for one Agent that the current parent Agent
  is allowed to delegate to. The result includes identity, model, thinking
  level, local-tool selection, MCP tool selection, and bound Skills.

  This command never exposes the delegate's system prompt or other undelegated
  Agents. It is read-only and always returns a JSON outcome envelope.

OPTIONS
  --help, -h   Show this help.
`;

const FLAGS: FlagSpec[] = [...SUBAGENT_HELP_FLAGS];

export function createDescribeCommand(manager: SubAgentManager): AppCommand {
  return {
    name: 'describe',
    synopsis: 'Describe one allowed delegate Agent and its safe capability summary.',
    help: HELP,

    async run(argv: readonly string[], ctx: AppCmdContext): Promise<void> {
      const parsed = parseFlags(argv, FLAGS);
      if (!parsed.ok) {
        ctx.printErr(`subagent describe: ${parsed.error}.\n`);
        ctx.setExitCode(2);
        return;
      }
      if (isHelp(parsed.flags)) {
        ctx.print(HELP);
        return;
      }
      if (parsed.positional.length !== 1 || parsed.positional[0].trim().length === 0) {
        ctx.printErr('subagent describe: requires exactly one non-empty <agent-id>.\n');
        ctx.setExitCode(2);
        return;
      }

      const outcome = await manager.describeDelegate(
        toSubAgentCommandScope(ctx),
        parsed.positional[0].trim(),
      );
      printSubAgentCommandOutcome(ctx, outcome);
    },
  };
}
