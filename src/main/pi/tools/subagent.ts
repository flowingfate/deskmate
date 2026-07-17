import type { Profile } from '@main/profile';

import { executeCommandFacade } from '../appcmd/executeCommandFacade';
import { createSubAgentCommand } from '../subagent/commands';
import { jsonSchema } from './schema';
import type { LocalTool } from './types';

interface SubagentArgs {
  cmd: string;
}

const SubagentParams = jsonSchema({
  type: 'object',
  properties: {
    cmd: {
      type: 'string',
      description:
        'Shell-style subagent command. Run "--help", or call with empty cmdline, to see usage. ' +
        'Use list, describe, run, or continue a persisted delegated conversation.',
    },
  },
  required: ['cmd'],
});

const commandsByProfile = new WeakMap<Profile, ReturnType<typeof createSubAgentCommand>>();

function getSubAgentCommand(profile: Profile): ReturnType<typeof createSubAgentCommand> {
  const existing = commandsByProfile.get(profile);
  if (existing) return existing;

  const command = createSubAgentCommand(profile.getSubAgentManager());
  commandsByProfile.set(profile, command);
  return command;
}

export const subagent: LocalTool<typeof SubagentParams> = {
  spec: {
    name: 'subagent',
    description:
      'Delegate work to allowed Agents. Use list, describe <agent-id>, run <agent-id> --task --expect, ' +
      'or continue <subrun-id> --message. Run "--help" or call with empty cmdline for detailed usage.',
    parameters: SubagentParams,
  },
  async handler(args, ctx) {
    const command = getSubAgentCommand(ctx.profile);
    return executeCommandFacade(command, (args as SubagentArgs).cmd, ctx);
  },
};
