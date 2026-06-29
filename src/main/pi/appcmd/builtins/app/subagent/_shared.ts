/**
 * `subagent` 命令族的内部 helper。
 *
 * 文件命名以 `_` 前缀,显式与"subcommand 文件"区分:
 *   - `_shared.ts` = 内部 util,**不**对应任何 LLM 可见命令
 *   - `spawn.ts` / `spawn-many.ts` = 一个 subcommand
 *
 * 这里的 helper 都是纯函数 + 单一职责。任何与 SubAgentManager 的真实交互
 * 都在 kernel 层,**不**外溢到 _shared.ts。
 */
import type { SubAgentManager } from '@main/lib/subAgent/subAgentManager';
import { SubAgentManager as SubAgentManagerImpl } from '@main/lib/subAgent/subAgentManager';

import type { AppCmdContext } from '../../../types';

/**
 * 校验 ctx 是否满足 spawn 类命令的契约:
 *   - 不是 sub-agent 链路(递归 spawn 拒绝)
 *   - `getSubAgentConfig` / `getParentContextSummary` 已被 caller 注入
 *
 * 通过返回 `manager` 单例,失败时返回 error 字符串供子命令落 stderr +
 * exit code。这把"spawn 前置校验"集中在一处,spawn / spawn-many 共用。
 *
 * 拒绝场景退出码语义(与 mcp/skill 等域纪律一致):
 *   - recursion:exit 1(业务拒绝)
 *   - missing ctx field:exit 1(应用启动期编程错误,LLM 看到原因即可)
 */
export function ensureSpawnPrerequisites(
  ctx: AppCmdContext,
): { ok: true; manager: SubAgentManager } | { ok: false; error: string } {
  if (ctx.isSubAgent) {
    return {
      ok: false,
      error: 'recursion not allowed: sub-agents cannot spawn other sub-agents.',
    };
  }
  if (!ctx.getSubAgentConfig) {
    return {
      ok: false,
      error: 'spawn requires ctx.getSubAgentConfig (caller must inject it).',
    };
  }
  if (!ctx.getParentContextSummary) {
    return {
      ok: false,
      error: 'spawn requires ctx.getParentContextSummary (caller must inject it).',
    };
  }
  return { ok: true, manager: SubAgentManagerImpl.getInstance() };
}

/**
 * 解析 spawn-many 的 `--task "name:task description"` 形态。冒号是首个
 * 分隔符,其后整段是 task description(允许内含 `:`)—— 与 `--env KEY=VAL`
 * 的范式一致(KEY 不允许 `=`,但 VAL 允许)。
 *
 * 任何不符合 `name:task` 的 entry 都失败,**绝不**默默把 entry 当 name 处理 ——
 * 那会让 LLM 拿到沉默的"task 是空字符串"行为,bug 很难定位。
 *
 * 返回 `{ name, task }` 不带 shareContext —— 该字段在 caller 层从
 * cmdline-level `--share-context` 应用到全部 task。
 */
export function parseTaskFlag(
  raw: string | boolean | readonly string[] | undefined,
): { ok: true; tasks: Array<{ name: string; task: string }> } | { ok: false; error: string } {
  if (raw === undefined || raw === false) {
    return { ok: false, error: 'missing required --task flag (repeatable).' };
  }
  if (typeof raw === 'boolean' || typeof raw === 'string') {
    return parseTaskEntries([typeof raw === 'string' ? raw : '']);
  }
  return parseTaskEntries(Array.from(raw));
}

function parseTaskEntries(
  entries: readonly string[],
): { ok: true; tasks: Array<{ name: string; task: string }> } | { ok: false; error: string } {
  if (entries.length === 0) {
    return { ok: false, error: 'missing required --task flag (repeatable).' };
  }
  const tasks: Array<{ name: string; task: string }> = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      return { ok: false, error: `--task entry must be string, got ${typeof entry}.` };
    }
    const colon = entry.indexOf(':');
    if (colon < 0) {
      return {
        ok: false,
        error: `--task entry must be "name:task description", got "${entry}".`,
      };
    }
    const name = entry.slice(0, colon).trim();
    const task = entry.slice(colon + 1).trim();
    if (!name) {
      return { ok: false, error: `--task entry has empty <name>: "${entry}".` };
    }
    if (!task) {
      return { ok: false, error: `--task entry has empty <task description>: "${entry}".` };
    }
    tasks.push({ name, task });
  }
  return { ok: true, tasks };
}

/**
 * 解析 spawn-many 的 `--config-json` 形态(escape hatch)。JSON 数组,每元素
 * 形如 `{ name: string, task: string, shareContext?: boolean }`。
 *
 * 与 `--task` 的协议:互斥 —— 同时给 `--config-json` 与 `--task` 会让 LLM
 * 困惑哪个胜出,caller 直接 exit 2;只接受一个来源,文档化在 spawn-many
 * help 里(`tool-system.md §9.5` `--config-json` 纪律)。
 */
export function parseConfigJsonFlag(
  raw: string | boolean | readonly string[] | undefined,
):
  | { ok: true; tasks: Array<{ name: string; task: string; shareContext: boolean }> }
  | { ok: false; error: string } {
  if (raw === undefined || raw === false) {
    return { ok: false, error: '--config-json not provided.' };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      error: '--config-json takes a single JSON string (it is not repeatable).',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `--config-json parse error: ${msg}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: '--config-json must be an array of task objects.' };
  }
  const tasks: Array<{ name: string; task: string; shareContext: boolean }> = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `--config-json[${i}] must be an object.` };
    }
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const task = typeof rec.task === 'string' ? rec.task.trim() : '';
    if (!name) {
      return { ok: false, error: `--config-json[${i}].name must be a non-empty string.` };
    }
    if (!task) {
      return { ok: false, error: `--config-json[${i}].task must be a non-empty string.` };
    }
    const shareContext = rec.shareContext === true;
    tasks.push({ name, task, shareContext });
  }
  return { ok: true, tasks };
}
