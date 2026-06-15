/**
 * `skill` 命令族的内部 helper —— 多个 subcommand 共享的小函数。
 *
 * 与 `mcp/_shared.ts` / `agent/_shared.ts` 同设计:这里只放纯函数 + 单一
 * 职责的 util,任何与 skill kernel / profile 的真实交互都在 subcommand
 * 文件里,**不**外溢到 _shared.ts。
 */

import { Profiles } from '@main/persist';
import type { SkillAgentTarget } from '@main/lib/skill/applySkillToAgents';

/**
 * 校验 skill name(或 query 字符串)。subcommand 拿到 positional[0] 后立即
 * 调本函数 —— 把"必填、非空、trim 后非空"这条约束集中在一处。
 */
export function validateName(
  raw: string | undefined,
  label = '<name>',
): { ok: true; name: string } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: `missing required ${label} argument.` };
  }
  const name = raw.trim();
  if (!name) {
    return { ok: false, error: `${label} must be non-empty after trim.` };
  }
  return { ok: true, name };
}

/**
 * 校验一个或多个 skill name(positional 多个,或 `--skill-name` 重复)。
 * 去重 + trim 过滤,空集返回 error。
 */
export function normalizeSkillNames(
  values: readonly string[],
): { ok: true; names: string[] } | { ok: false; error: string } {
  const names = Array.from(
    new Set(
      values
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v): v is string => !!v),
    ),
  );
  if (names.length === 0) {
    return { ok: false, error: 'skill name list is empty after trim/dedup.' };
  }
  return { ok: true, names };
}

/**
 * 默认 agent target 解析:bind / unbind 命令未提供 `--agent-name` / `--all`
 * 时,target = 当前 chat 的 agent。
 *
 * 与老 `apply_skill_to_agents` / `remove_skills_from_agents` facade 行为对齐:
 *   - ctx.agentId 空(IPC debug 入口 / 无 chat session)→ 返回 error,caller
 *     按需把它转成 exit 1 + 提示用户显式 `--agent-name` / `--all`。
 *   - ctx.agentId 非空 → 返回 [{ agentId, agentName }] 单元素数组。
 */
export async function resolveDefaultAgentTarget(
  currentAgentId: string,
): Promise<{ ok: true; targets: SkillAgentTarget[] } | { ok: false; error: string }> {
  if (!currentAgentId) {
    return {
      ok: false,
      error:
        'No active chat context. Pass --agent-name <name> (repeatable) or --all-agents to target explicitly.',
    };
  }

  let profile;
  try {
    profile = Profiles.get().activeSync();
  } catch {
    return {
      ok: false,
      error: 'No current user session found. Please ensure you are logged in.',
    };
  }

  const agent = await profile.getAgent(currentAgentId);
  if (!agent) {
    return { ok: false, error: 'Current chat not found.' };
  }
  return { ok: true, targets: [{ agentId: currentAgentId, agentName: agent.config.name }] };
}

/**
 * 把 parseFlags 给的 `string | boolean | readonly string[] | undefined`
 * 收敛成 trimmed 非空字符串数组(可重复 flag 的标准 normaliser)。
 */
export function normalizeArrayFlag(
  raw: string | boolean | readonly string[] | undefined,
): string[] {
  if (raw === undefined || raw === false || raw === true) return [];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  return Array.from(
    new Set(
      raw
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v): v is string => !!v),
    ),
  );
}
