/**
 * `mcp update <name> [--transport ...] [--command ...] [--env KEY=VAL ...]`
 *
 * 更新一个**已安装**的 MCP server 的部分字段。语义:
 *   - 只携带 `--xxx` 的字段被更新;其它保留
 *   - version 由 `updateServerInternal` 自动 patch+1
 *
 * 不接 `--dry-run` —— update 是已存在 server 的字段修改,LLM 想 dry-run
 * 应该先 `mcp status <name>` 看现状再决定。
 */

import { Profiles } from '@main/persist';
import {
  updateServerInternal,
  type UpdateServerResult,
} from './kernel/updateServer';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { parseEnvFlags, validateName } from './_shared';

const HELP = `USAGE
  mcp update <name> [options]

DESCRIPTION
  Update fields of an already-installed MCP server. Only the flags you
  pass are changed; everything else is kept. Version is bumped automatically.

OPTIONS
  --transport <kind>  stdio | sse | StreamableHttp
  --command <bin>     Executable (for stdio).
  --arg <token>       Command argv entry. Repeatable.
  --url <url>         Server URL (for sse / StreamableHttp).
  --env KEY=VALUE     Override env var. Repeatable.
  --json              Output the result as JSON.
  --help, -h          Show this help.

EXAMPLES
  mcp update brave-search --env BRAVE_API_KEY=new-key
  mcp update my-stdio --command node --arg new-server.js
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



export async function runUpdate(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`mcp update: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `mcp update: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`mcp update: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  // 1. 确认 server 已安装
  const profile = await Profiles.get().active();
  const existing = profile.mcp.get(name);
  if (!existing) {
    ctx.printErr(
      `mcp update: server "${name}" is not installed.\n` +
        'Hint: use "mcp add" first.\n',
    );
    ctx.setExitCode(1);
    return;
  }

  // 2. 校验 --transport(如果给了)
  const transport = parsed.flags.transport;
  let transportTyped: Transport | undefined;
  if (transport !== undefined) {
    if (typeof transport !== 'string' || !(VALID_TRANSPORTS as readonly string[]).includes(transport)) {
      ctx.printErr(
        `mcp update: invalid --transport "${String(transport)}". Must be one of: ${VALID_TRANSPORTS.join(', ')}.\n`,
      );
      ctx.setExitCode(2);
      return;
    }
    transportTyped = transport as Transport;
  }

  const envResult = parseEnvFlags(parsed.flags.env);
  if (!envResult.ok) {
    ctx.printErr(`mcp update: ${envResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  // 3. partial payload
  const patch: {
    name: string;
    transport?: Transport;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
  } = {
    name,
  };

  if (transportTyped) patch.transport = transportTyped;
  if (typeof parsed.flags.command === 'string') patch.command = parsed.flags.command;
  if (Array.isArray(parsed.flags.arg)) patch.args = Array.from(parsed.flags.arg as readonly string[]);
  if (envResult.env) patch.env = envResult.env;
  if (typeof parsed.flags.url === 'string') patch.url = parsed.flags.url;

  const result: UpdateServerResult = await updateServerInternal(
    { mcp_config: patch },
    { signal: ctx.signal },
  );

  if (!result.success) {
    ctx.printErr(`mcp update: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify({ success: true, action: 'update', name, patch }, null, 2) + '\n');
    return;
  }
  ctx.print(`Updated MCP server "${name}". ${result.message}\n`);
}
