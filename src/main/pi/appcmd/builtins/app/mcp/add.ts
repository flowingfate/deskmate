/**
 * `mcp add <name> --transport <stdio|sse|StreamableHttp> [...] [--dry-run]`
 *
 * 添加一个 MCP server,完全由 LLM 显式构造配置。
 *
 * 必填:
 *   - `--transport stdio|sse|StreamableHttp`
 *   - stdio  → 至少 `--command`
 *   - sse / StreamableHttp → 至少 `--url`
 *
 * 可选:
 *   - `--arg <token>`(可重复)  → command 的 argv
 *   - `--env KEY=VAL`(可重复)
 *
 * `--dry-run` 演练:打印 resolved config,不下盘。
 * `--json` 输出 add envelope。
 */

import {
  createServerInternal,
  type CreateServerResult,
} from './kernel/createServer';

import { COMMON_FLAGS, isDryRun, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { parseEnvFlags, validateName } from './_shared';

const HELP = `USAGE
  mcp add <name> --transport <kind> [options]

DESCRIPTION
  Add an MCP server. The full configuration is provided explicitly via flags;
  the runtime persists it and starts a connection.

REQUIRED
  --transport <kind>  One of: stdio | sse | StreamableHttp
                      stdio          requires --command
                      sse            requires --url
                      StreamableHttp requires --url

OPTIONS
  --command <bin>     Executable for stdio transport (e.g. "node", "npx").
  --arg <token>       Argv entry for the command. Repeatable in order.
  --url <url>         Server URL for sse / StreamableHttp transports.
  --env KEY=VALUE     Env var for the server process. Repeatable.
  --dry-run           Show the would-be config without writing.
  --json              Output the config as JSON instead of a summary.
  --help, -h          Show this help.

EXAMPLES
  mcp add my-stdio --transport stdio --command npx --arg -y --arg my-pkg
  mcp add my-remote --transport sse --url https://example.com/sse
  mcp add my-stdio --transport stdio --command node --arg server.js \\
    --env API_KEY=xxx --dry-run --json
`;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'transport', type: 'string' },
  { name: 'command', type: 'string' },
  { name: 'arg', type: 'array' },
  { name: 'url', type: 'string' },
  { name: 'env', type: 'array' },
];

const VALID_TRANSPORTS = ['stdio', 'sse', 'StreamableHttp'] as const;
type Transport = (typeof VALID_TRANSPORTS)[number];

export async function runAdd(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`mcp add: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length === 0) {
    ctx.printErr('mcp add: missing required <name>.\nTry "mcp add --help".\n');
    ctx.setExitCode(2);
    return;
  }
  if (parsed.positional.length > 1) {
    ctx.printErr(
      `mcp add: too many positional args (${parsed.positional.length}); only <name> is accepted.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`mcp add: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const transport = parsed.flags.transport;
  if (typeof transport !== 'string') {
    ctx.printErr('mcp add: --transport is required.\n');
    ctx.setExitCode(2);
    return;
  }
  if (!(VALID_TRANSPORTS as readonly string[]).includes(transport)) {
    ctx.printErr(
      `mcp add: invalid --transport "${transport}". Must be one of: ${VALID_TRANSPORTS.join(', ')}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }
  const tport = transport as Transport;

  const command = typeof parsed.flags.command === 'string' ? parsed.flags.command : undefined;
  const url = typeof parsed.flags.url === 'string' ? parsed.flags.url : undefined;
  const argList = Array.isArray(parsed.flags.arg)
    ? Array.from(parsed.flags.arg as readonly string[])
    : undefined;

  if (tport === 'stdio' && !command) {
    ctx.printErr('mcp add: --command is required for --transport stdio.\n');
    ctx.setExitCode(2);
    return;
  }
  if ((tport === 'sse' || tport === 'StreamableHttp') && !url) {
    ctx.printErr(`mcp add: --url is required for --transport ${tport}.\n`);
    ctx.setExitCode(2);
    return;
  }

  const envResult = parseEnvFlags(parsed.flags.env);
  if (!envResult.ok) {
    ctx.printErr(`mcp add: ${envResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  const finalConfig = {
    name,
    transport: tport,
    command,
    args: argList,
    env: envResult.env,
    url,
    version: '1.0.0',
  };

  if (isDryRun(parsed.flags)) {
    if (isJson(parsed.flags)) {
      ctx.print(
        JSON.stringify({ dryRun: true, action: 'add', config: finalConfig }, null, 2) + '\n',
      );
    } else {
      ctx.print(
        `[dry-run] mcp add "${name}" (custom).\n` +
          `  transport: ${tport}\n` +
          (command ? `  command:   ${command}\n` : '') +
          (argList && argList.length > 0 ? `  args:      ${argList.join(' ')}\n` : '') +
          (url ? `  url:       ${url}\n` : '') +
          (envResult.env && Object.keys(envResult.env).length > 0
            ? `  env:       ${Object.keys(envResult.env).join(', ')}\n`
            : '') +
          'Nothing was written. Re-run without --dry-run to apply.\n',
      );
    }
    return;
  }

  const createResult: CreateServerResult = await createServerInternal(
    { mcp_config: finalConfig },
    { profile: ctx.profile, signal: ctx.signal },
  );

  if (!createResult.success) {
    ctx.printErr(`mcp add: ${createResult.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(
      JSON.stringify(
        { success: true, action: 'add', name, config: finalConfig },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  ctx.print(
    `Added MCP server "${name}" (transport=${tport}). Connection is starting.\n` +
      'Run "app mcp status ' + name + ' --wait" to block until it settles.\n',
  );
}
