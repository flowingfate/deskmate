/**
 * `mcp connect|disconnect|reconnect <name>` —— 三个 idempotent 动作共用
 * 一个文件。它们都是"对一个已安装 server 切换连接态",参数完全一样,
 * 业务逻辑只差一个 verb,**强内聚** —— 拆三个文件只会增加翻文件成本
 * (详见 `ai.prompt/tool-system.md` §6.3 "为什么不按 parse vs run 拆")。
 *
 * 与旧 `runSetMcpConnectionState` 的差异:
 *   - 透传 `ctx.signal`(旧 facade 没有透传)
 *   - 报错走 stderr + exit code(LLM 母语),不是 JSON envelope
 *   - manager 从 `ctx.profileId` 解析的 runtime Profile 取得；先确认 server
 *     配置存在，再执行连接动作。
 */

import type { MCPServerRuntimeState } from '@main/lib/mcpRuntime';
import type { McpServerConfig } from '@shared/persist/types'

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { describeStatus, validateName } from './_shared';

type ConnectionAction = 'connect' | 'disconnect' | 'reconnect';

const HELP_CONNECT = `USAGE
  mcp connect <name>

DESCRIPTION
  Start the connection to an already-installed MCP server. Idempotent:
  if already connected, returns the current status without error.

OPTIONS
  --json       Output the result as JSON.
  --help, -h   Show this help.
`;

const HELP_DISCONNECT = `USAGE
  mcp disconnect <name>

DESCRIPTION
  Stop the connection to an MCP server (config is kept).
  Idempotent: if already disconnected, returns the current status without error.

OPTIONS
  --json       Output the result as JSON.
  --help, -h   Show this help.
`;

const HELP_RECONNECT = `USAGE
  mcp reconnect <name>

DESCRIPTION
  Disconnect (if connected) and then connect again. Useful when the server
  process is stuck or after editing env / args via "mcp update".

OPTIONS
  --json       Output the result as JSON.
  --help, -h   Show this help.
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export function runConnect(argv: string[], ctx: AppCmdContext): Promise<void> {
  return runConnection('connect', HELP_CONNECT, argv, ctx);
}

export function runDisconnect(argv: string[], ctx: AppCmdContext): Promise<void> {
  return runConnection('disconnect', HELP_DISCONNECT, argv, ctx);
}

export function runReconnect(argv: string[], ctx: AppCmdContext): Promise<void> {
  return runConnection('reconnect', HELP_RECONNECT, argv, ctx);
}

async function runConnection(
  action: ConnectionAction,
  help: string,
  argv: string[],
  ctx: AppCmdContext,
): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`mcp ${action}: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(help);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `mcp ${action}: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`mcp ${action}: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  if (ctx.signal.aborted) {
    ctx.printErr(`mcp ${action}: aborted before start.\n`);
    ctx.setExitCode(1);
    return;
  }

  // ToolContext 在 turn 创建时已绑定 owning runtime Profile。
  const profile = ctx.profile;
  const config: McpServerConfig | null = profile.store.mcp.get(name) ?? null;
  if (!config) {
    ctx.printErr(
      `mcp ${action}: server "${name}" is not installed. ` +
        'Use "mcp install" or "mcp add" first.\n',
    );
    ctx.setExitCode(1);
    return;
  }

  const previousStatus = snapshotStatus(profile.mcpManager, name);

  try {
    switch (action) {
      case 'connect':
        await profile.mcpManager.connect(name);
        break;
      case 'disconnect':
        await profile.mcpManager.disconnect(name);
        break;
      case 'reconnect':
        await profile.mcpManager.reconnect(name);
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const currentStatus = snapshotStatus(profile.mcpManager, name);
    if (isJson(parsed.flags)) {
      ctx.printErr(
        JSON.stringify(
          {
            success: false,
            action,
            name,
            error: msg,
            previousStatus,
            currentStatus,
          },
          null,
          2,
        ) + '\n',
      );
    } else {
      ctx.printErr(
        `mcp ${action}: failed for "${name}": ${msg}\n` +
          `  previous: ${describeStatus(previousStatus)}\n` +
          `  current:  ${describeStatus(currentStatus)}\n`,
      );
    }
    ctx.setExitCode(1);
    return;
  }

  const currentStatus = snapshotStatus(profile.mcpManager, name);

  if (isJson(parsed.flags)) {
    ctx.print(
      JSON.stringify(
        {
          success: true,
          action,
          name,
          previousStatus,
          currentStatus,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  ctx.print(
    `mcp ${action} "${name}": ${describeStatus(currentStatus)} (was ${describeStatus(previousStatus)}).\n`,
  );
}

function snapshotStatus(manager: { getMcpServerRuntimeState(name: string): MCPServerRuntimeState | undefined }, name: string): string {
  return manager.getMcpServerRuntimeState(name)?.status ?? 'disconnected';
}
