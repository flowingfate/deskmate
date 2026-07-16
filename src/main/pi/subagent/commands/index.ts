import { makeRouterCommand } from '../../appcmd/makeRouterCommand';
import { AppCommandRegistry } from '../../appcmd/registry';
import type { AppCommand } from '../../appcmd/types';

import { createDescribeCommand } from './describe';
import { createListCommand } from './list';
import { createRunCommand } from './run';
import type { SubAgentManager } from '../manager';

const HELP_FOOTER = `DELEGATION RULES
  * Use list to discover stable allowed Agent IDs, then describe an ID when
    detailed capability selection matters. Never target an Agent by name.
  * Per run: default 25 turns, maximum 100; timeout defaults to 60 seconds per
    turn and is capped at 3600 seconds.
  * For parallel work, emit multiple subagent tool calls in the same assistant
    response, each invoking run once; the host executes those calls concurrently.
  * Per parent session: at most 5 runs in parallel and 20 total reservations.
  * Delegated Agents cannot call subagent or ask for interactive input. web
  * research and shell device authentication may also be rejected because they require human interaction.`;

export type {
  SubAgentCommandOutcome,
  SubAgentCommandScope,
  SubAgentDelegateDescription,
  SubAgentDelegateSummary,
  SubAgentDescribeDelegateOutcome,
  SubAgentListDelegatesOutcome,
  SubAgentLocalToolSelection,
  SubAgentMcpSelection,
  SubAgentSkillSelection,
} from './types';

export function createSubAgentCommand(manager: SubAgentManager): AppCommand {
  const registry = new AppCommandRegistry();
  registry.register(createDescribeCommand(manager));
  registry.register(createListCommand(manager));
  registry.register(createRunCommand(manager));

  return makeRouterCommand({
    name: 'subagent',
    synopsis: 'List and describe allowed delegate Agents, or delegate one task.',
    registry,
    helpFooter: HELP_FOOTER,
  });
}
