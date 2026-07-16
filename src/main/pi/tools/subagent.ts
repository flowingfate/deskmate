import { Profiles, type Profile } from '@main/persist';

import { executeCommandFacade } from '../appcmd/executeCommandFacade';
import { createSubAgentCommand } from '../subagent/commands';
import { SubAgentManager } from '../subagent/manager';
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
        'Use list to discover allowed Agents, describe an Agent, or run a delegated task.',
    },
  },
  required: ['cmd'],
});

const commandsByProfile = new WeakMap<Profile, ReturnType<typeof createSubAgentCommand>>();

function getSubAgentCommand(profile: Profile): ReturnType<typeof createSubAgentCommand> {
  const existing = commandsByProfile.get(profile);
  if (existing) return existing;

  const command = createSubAgentCommand(SubAgentManager.forProfile(profile));
  commandsByProfile.set(profile, command);
  return command;
}

export const subagent: LocalTool<typeof SubagentParams> = {
  spec: {
    name: 'subagent',
    description:
      'Delegate work to allowed Agents. Use list, describe <agent-id>, or run <agent-id> --task --expect. ' +
      'Run "--help" or call with empty cmdline for detailed usage.',
    parameters: SubagentParams,
  },
  async handler(args, ctx) {
    const profile = await Profiles.get().active();
    if (profile.id !== ctx.profileId) {
      return { ok: false, error: 'Subagent command profile is unavailable.' };
    }
    const command = getSubAgentCommand(profile);
    return executeCommandFacade(command, (args as SubagentArgs).cmd, ctx);
  },
};
