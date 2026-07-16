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
  subagent list

DESCRIPTION
  List the ordinary Agents that the current parent Agent is allowed to
  delegate to. The result includes stable Agent IDs, names, descriptions, and
  models in configured order, plus unavailable configured IDs.

  Use an ID from the available list with "subagent run" or "subagent describe".
  This command is read-only and always returns a JSON outcome envelope.

OPTIONS
  --help, -h   Show this help.
`;

const FLAGS: FlagSpec[] = [...SUBAGENT_HELP_FLAGS];

export function createListCommand(manager: SubAgentManager): AppCommand {
  return {
    name: 'list',
    synopsis: 'List allowed delegate Agents and unavailable configured IDs.',
    help: HELP,

    async run(argv: readonly string[], ctx: AppCmdContext): Promise<void> {
      const parsed = parseFlags(argv, FLAGS);
      if (!parsed.ok) {
        ctx.printErr(`subagent list: ${parsed.error}.\n`);
        ctx.setExitCode(2);
        return;
      }
      if (isHelp(parsed.flags)) {
        ctx.print(HELP);
        return;
      }
      if (parsed.positional.length > 0) {
        ctx.printErr('subagent list: takes no positional arguments.\n');
        ctx.setExitCode(2);
        return;
      }

      const outcome = await manager.listDelegates(toSubAgentCommandScope(ctx));
      printSubAgentCommandOutcome(ctx, outcome);
    },
  };
}
