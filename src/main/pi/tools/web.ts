/**
 * `web` LocalTool —— Web 抓取与搜索能力的一等 shell 入口。
 *
 * LLM 通过单个 cmdline 进入 webCommands registry；路由、help 和命令索引由
 * makeRouterCommand 保持唯一实现，LocalTool 的 schema 与调用边界则在此可见。
 */
import { webCommands } from '../appcmd/builtins/web';
import { executeCommandFacade } from '../appcmd/executeCommandFacade';
import { makeRouterCommand } from '../appcmd/makeRouterCommand';
import { jsonSchema } from './schema';
import type { LocalTool } from './types';

interface WebArgs {
  cmd: string;
}

const WebParams = jsonSchema({
  type: 'object',
  properties: {
    cmd: {
      type: 'string',
      description:
        'Shell-style command line for the "web" tool. ' +
        'Run "--help", or call with empty cmdline, to see usage and the available first-token list. ' +
        'Add --json for structured output when supported, --dry-run / --yes for destructive ops. ' +
        'Example: web("...")',
    },
  },
  required: ['cmd'],
});

const webCommand = makeRouterCommand({
  name: 'web',
  synopsis: 'Search / image-search the web, fetch URLs, download files',
  registry: webCommands,
});

export const web: LocalTool<typeof WebParams> = {
  spec: {
    name: webCommand.name,
    get description() {
      return webCommand.toolDescription ? webCommand.toolDescription() : webCommand.synopsis;
    },
    parameters: WebParams,
  },
  async handler(args, ctx) {
    return executeCommandFacade(webCommand, (args as WebArgs).cmd, ctx);
  },
};
