/**
 * Agent kernel 共享小 helper —— 按 name 在 active profile 中查 agent。
 *
 * 角色:`removeAgent.ts` / `update.ts`(subcommand)读 existing source/version 时
 * 用。提取出来避免每个 kernel 自己写一遍。
 *
 * 重名取第一条(与历史 `manageAgents.findAgentByName` 行为一致)。返回 null
 * 表示 not found —— caller 自己决定回什么错。
 */

import type { Agent } from '@main/persist/agent';
import type { Profile } from '@main/persist/profile';

export async function findAgentByName(
  profile: Profile,
  name: string,
): Promise<{ id: string; agent: Agent } | null> {
  const records = profile.listAgents();
  const rec = records.find((r) => r.name === name);
  if (!rec) return null;
  const agent = await profile.getAgent(rec.id);
  if (!agent) return null;
  return { id: rec.id, agent };
}
