/**
 * `mcp` 命令族的内部 helper —— 多个 subcommand 共享的小函数。
 *
 * 文件命名以 `_` 前缀,显式与"subcommand 文件"区分:
 *   - `_shared.ts` = 内部 util,**不**对应任何 LLM 可见命令
 *   - `install.ts` / `add.ts` / ... = 一个 subcommand
 *
 * 这里的 helper 都是纯函数 + 单一职责。任何与 mcpClientManager 或 internal
 * helper 的真实交互都在对应 subcommand 文件里,**不**外溢到 _shared.ts —— 避免
 * "shared util 偷偷做副作用"的陷阱。
 */

import type { McpStatus } from './kernel/getStatus';

/** 解析 `--env KEY=val` flag 集合;空数组 / undefined 返回 undefined。 */
export function parseEnvFlags(
  raw: string | boolean | readonly string[] | undefined,
): { ok: true; env?: Record<string, string> } | { ok: false; error: string } {
  if (raw === undefined || raw === false) return { ok: true, env: undefined };
  if (typeof raw === 'boolean' || typeof raw === 'string') {
    // 单值或 boolean 形态:容错解析 —— LLM 偶尔会写 `--env KEY=val` 单次,
    // parseFlags 在 spec 是 array 时仍包成 string[],这里防御性兼容
    // (不会真的被触发,因为我们 spec 设为 array)。
    const entries = typeof raw === 'string' ? [raw] : [];
    return parseEnvEntries(entries);
  }
  return parseEnvEntries(Array.from(raw));
}

function parseEnvEntries(
  entries: readonly string[],
): { ok: true; env?: Record<string, string> } | { ok: false; error: string } {
  if (entries.length === 0) return { ok: true, env: undefined };
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      return {
        ok: false,
        error: `invalid --env "${entry}": expected KEY=VALUE (KEY must be non-empty).`,
      };
    }
    const key = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1);
    if (!key) {
      return {
        ok: false,
        error: `invalid --env "${entry}": KEY must be non-empty.`,
      };
    }
    env[key] = value;
  }
  return { ok: true, env };
}

/**
 * 校验 server name。subcommand 拿到 positional[0] 后立即调本函数 ——
 * 把"name 必填、非空、trim 后非空"这条约束集中在一处。
 */
export function validateName(
  raw: string | undefined,
): { ok: true; name: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'missing required <name> argument.' };
  }
  const name = raw.trim();
  if (!name) {
    return { ok: false, error: '<name> must be non-empty after trim.' };
  }
  return { ok: true, name };
}

/**
 * 把 McpStatus / runtime status 渲染成人类一行说明。`status` subcommand
 * 与 connect/disconnect/reconnect 的回显共用。
 */
export function describeStatus(status: McpStatus | string): string {
  switch (status) {
    case 'Connected':
    case 'connected':
      return 'connected (running)';
    case 'Connecting':
    case 'connecting':
      return 'connecting (in progress)';
    case 'Disconnected':
    case 'disconnected':
      return 'disconnected (configured but not running)';
    case 'Disconnecting':
    case 'disconnecting':
      return 'disconnecting (in progress)';
    case 'Error':
    case 'error':
      return 'error (last connection failed)';
    case 'NeedsUserInteraction':
    case 'needs-user-interaction':
      return 'needs-user-interaction (authentication required)';
    case 'NotAdded':
      return 'not-added (not in profile)';
    default:
      return String(status);
  }
}
