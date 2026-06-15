/**
 * `mcp status <name> [--json]`
 *
 * 只读:打印 server 的运行状态。LLM 用得最频繁的一类命令 —— 任何 install /
 * connect 之后跟一个 `mcp status` 看看真的起没起来。
 *
 * 输出维度(human 模式):
 *   - status            一行 + 中文 / 英文混合的人话描述
 *   - transport         (如有)
 *   - tools_count       (如有)
 *   - error_message     (status=Error 时给出)
 *
 * `--json` 模式直接透传 `GetStatusResult`,LLM 容易接着串别的命令。
 */

import {
  getStatusInternal,
  type GetStatusResult,
} from './kernel/getStatus';

import { COMMON_FLAGS, isHelp, isJson } from '../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../flags';
import type { AppCmdContext } from '../../types';

import { describeStatus, validateName } from './_shared';

const HELP = `USAGE
  mcp status <name>

DESCRIPTION
  Show the current status of an MCP server. Read-only.

  Status values:
    Connected             active and running
    Connecting            connection in progress
    Disconnected          configured but not running
    Disconnecting         disconnection in progress
    Error                 connection failed (see error_message)
    NeedsUserInteraction  authentication required
    NotAdded              not in profile

OPTIONS
  --json       Output the raw status object as JSON.
  --help, -h   Show this help.
`;

const FLAGS: FlagSpec[] = [...COMMON_FLAGS];

export async function runStatus(argv: string[], ctx: AppCmdContext): Promise<void> {
  const parsed = parseFlags(argv, FLAGS);
  if (!parsed.ok) {
    ctx.printErr(`mcp status: ${parsed.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  if (isHelp(parsed.flags)) {
    ctx.print(HELP);
    return;
  }

  if (parsed.positional.length !== 1) {
    ctx.printErr(
      `mcp status: expected exactly one positional <name>, got ${parsed.positional.length}.\n`,
    );
    ctx.setExitCode(2);
    return;
  }

  const nameResult = validateName(parsed.positional[0]);
  if (!nameResult.ok) {
    ctx.printErr(`mcp status: ${nameResult.error}\n`);
    ctx.setExitCode(2);
    return;
  }
  const { name } = nameResult;

  const result: GetStatusResult = await getStatusInternal(
    { mcp_name: name },
    { signal: ctx.signal },
  );

  if (isJson(parsed.flags)) {
    ctx.print(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) ctx.setExitCode(1);
    return;
  }

  if (!result.success) {
    ctx.printErr(`mcp status: ${result.message}\n`);
    ctx.setExitCode(1);
    return;
  }

  const lines: string[] = [];
  lines.push(`mcp status "${name}": ${describeStatus(result.status)}`);
  if (result.details?.transport) lines.push(`  transport:   ${result.details.transport}`);
  if (typeof result.details?.tools_count === 'number') {
    lines.push(`  tools_count: ${result.details.tools_count}`);
  }
  if (result.details?.in_use !== undefined) {
    lines.push(`  in_use:      ${result.details.in_use ? 'yes' : 'no'}`);
  }
  if (result.details?.error_message) {
    lines.push(`  error:       ${result.details.error_message}`);
  }
  ctx.print(lines.join('\n') + '\n');
}
