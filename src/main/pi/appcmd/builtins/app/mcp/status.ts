/**
 * `mcp status <name> [--json]`
 *
 * 只读:打印 server 的运行状态。LLM 用得最频繁的一类命令 —— 任何 install /
 * connect 之后跟一个 `mcp status` 看看真的起没起来。带 `--wait` 时会阻塞轮询
 * 到终态(connected/error/...),省掉 LLM 手动多次调用 `mcp status` 空转 token。
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

import { COMMON_FLAGS, isHelp, isJson } from '../../../_commonFlags';
import { parseFlags, type FlagSpec } from '../../../flags';
import type { AppCmdContext } from '../../../types';

import { describeStatus, validateName } from './_shared';

const HELP = `USAGE
  mcp status <name> [--wait] [--timeout <sec>]

DESCRIPTION
  Show the current status of an MCP server. Read-only.

  With --wait, block until the server reaches a terminal state (connected /
  error / disconnected / needs-user-interaction / not-added) instead of
  returning immediately while it is still "connecting". This avoids the need
  to poll "mcp status" repeatedly right after "mcp add" / "mcp connect".

  Status values:
    Connected             active and running
    Connecting            connection in progress
    Disconnected          configured but not running
    Disconnecting         disconnection in progress
    Error                 connection failed (see error_message)
    NeedsUserInteraction  authentication required
    NotAdded              not in profile

OPTIONS
  --wait           Block until the server settles (or --timeout elapses).
  --timeout <sec>  Max seconds to wait; implies --wait. Default 30, max 300.
  --json           Output the raw status object as JSON.
  --help, -h       Show this help.
`;

/** 仍在流转、值得继续等待的过渡态。其余状态视为终态。 */
const TRANSIENT_STATUSES = new Set<GetStatusResult['status']>([
  'Connecting',
  'Disconnecting',
]);

const DEFAULT_WAIT_SECONDS = 30;
const MAX_WAIT_SECONDS = 300;
const POLL_INTERVAL_MS = 400;

const FLAGS: FlagSpec[] = [
  ...COMMON_FLAGS,
  { name: 'wait', type: 'boolean' },
  { name: 'timeout', type: 'string' },
];

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

  const waitCfg = resolveWaitConfig(parsed.flags);
  if (!waitCfg.ok) {
    ctx.printErr(`mcp status: ${waitCfg.error}\n`);
    ctx.setExitCode(2);
    return;
  }

  const { result, timedOut } = await fetchStatus(name, waitCfg.value, ctx);

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
  if (timedOut) {
    lines.push(`  note:        still not settled after ${waitCfg.value}s wait`);
  }
  ctx.print(lines.join('\n') + '\n');
}

// ─────────────── wait/poll helpers ───────────────

/**
 * 解析 `--wait` / `--timeout`。`--timeout` 隐含 wait;二者都不给 → 单次快照
 * (value = 0)。非法/越界的 timeout → 报错让 caller exit 2。
 */
function resolveWaitConfig(
  flags: Readonly<Record<string, string | boolean | readonly string[]>>,
): { ok: true; value: number } | { ok: false; error: string } {
  const rawTimeout = flags.timeout;
  const wantWait = flags.wait === true || rawTimeout !== undefined;
  if (!wantWait) return { ok: true, value: 0 };

  if (rawTimeout === undefined) return { ok: true, value: DEFAULT_WAIT_SECONDS };
  if (typeof rawTimeout !== 'string') {
    return { ok: false, error: '--timeout requires a numeric value (seconds).' };
  }
  const seconds = Number(rawTimeout);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false, error: `--timeout must be a positive number, got "${rawTimeout}".` };
  }
  return { ok: true, value: Math.min(seconds, MAX_WAIT_SECONDS) };
}

/**
 * 取状态。`waitSeconds === 0` → 单次快照(原语义)。否则轮询到终态 /
 * 超时 / signal 中止。返回最后一次快照 + 是否因超时提前收尾。
 */
async function fetchStatus(
  name: string,
  waitSeconds: number,
  ctx: AppCmdContext,
): Promise<{ result: GetStatusResult; timedOut: boolean }> {
  let result = await getStatusInternal({ mcp_name: name }, { signal: ctx.signal });
  if (waitSeconds === 0) return { result, timedOut: false };

  const deadline = Date.now() + waitSeconds * 1000;
  while (result.success && TRANSIENT_STATUSES.has(result.status)) {
    if (ctx.signal.aborted || Date.now() >= deadline) {
      return { result, timedOut: !ctx.signal.aborted };
    }
    await sleep(POLL_INTERVAL_MS, ctx.signal);
    if (ctx.signal.aborted) return { result, timedOut: false };
    result = await getStatusInternal({ mcp_name: name }, { signal: ctx.signal });
  }
  return { result, timedOut: false };
}

/** 可被 AbortSignal 提前唤醒的 sleep;中止时静默 resolve(caller 自查 signal)。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => done();
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
