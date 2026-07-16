/**
 * `app` LocalTool —— "应用内能力" 的统一 shell 入口。
 *
 * LLM 通过单个 cmdline 进入 appCommands registry；路由、help 和命令索引由
 * makeRouterCommand 保持唯一实现，LocalTool 的 schema 与调用边界则在此可见。
 */
import { appCommands } from '../appcmd/builtins/app';
import { executeCommandFacade } from '../appcmd/executeCommandFacade';
import { makeRouterCommand } from '../appcmd/makeRouterCommand';
import { jsonSchema } from './schema';
import type { LocalTool } from './types';

interface AppArgs {
  cmd: string;
}

const AppParams = jsonSchema({
  type: 'object',
  properties: {
    cmd: {
      type: 'string',
      description:
        'Shell-style command line for the "app" tool. ' +
        'Run "--help", or call with empty cmdline, to see usage and the available first-token list. ' +
        'Add --json for structured output when supported, --dry-run / --yes for destructive ops. ' +
        'Example: app("...")',
    },
  },
  required: ['cmd'],
});

const appCommand = makeRouterCommand({
  name: 'app',
  synopsis: 'Run any in-app command (mcp / agent / skill / schedule / ...)',
  registry: appCommands,
});

export const app: LocalTool<typeof AppParams> = {
  spec: {
    name: appCommand.name,
    get description() {
      return appCommand.toolDescription ? appCommand.toolDescription() : appCommand.synopsis;
    },
    parameters: AppParams,
  },
  async handler(args, ctx) {
    return executeCommandFacade(appCommand, (args as AppArgs).cmd, ctx);
  },
};
