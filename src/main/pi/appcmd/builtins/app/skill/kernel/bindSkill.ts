/**
 * Skill "bind" 内核 —— 把已安装的 skill 绑到一个/多个 agent。
 *
 * 角色:被 `appcmd/builtins/app/skill/bind.ts` 调用。
 *
 * 与老 `apply_skill_to_agents` 工具的差别:
 *   - 老工具内嵌"skill 未安装则自动 install"逻辑;新设计**显式分离**:bind 仅绑,
 *     未装就拒绝并提示先 `skill install`。这与 shell 范式一致(`systemctl enable`
 *     不会自动 `apt install`)。
 *   - 默认 agent 解析(空 target → 当前 agent)由 CLI 层处理,kernel 不读 ctx。
 *
 * `signal` 仅做契约形状对齐 —— 该路径下持久化是同步快路径。
 */

import {
  applySkillToAgents,
  type ApplySkillToAgentsResult,
  type SkillAgentTarget,
} from '@main/lib/skill';
import { Profiles } from '@main/persist';

export interface BindSkillArgs {
  skill_name: string;
  /** 显式 target:每条 = { agentId, agentName }。当未提供 + agent_names 也空 + apply_to_all=false 时 → 不绑。 */
  targets?: SkillAgentTarget[];
  /** 按 agent 名字解析 target(支持多个同名 agent)。 */
  agent_names?: string[];
  /** 全 agent 模式:无视 targets / agent_names,绑所有 agent。 */
  apply_to_all?: boolean;
  request_source?: string;
}

export interface BindSkillResult {
  success: boolean;
  message: string;
  skill_name: string;
  applied_count: number;
  already_applied_count: number;
  failed_count: number;
  applied_targets: SkillAgentTarget[];
  skipped_targets: Array<SkillAgentTarget & { reason: string }>;
  error?: string;
}

export async function bindSkillInternal(
  args: BindSkillArgs,
  _opts?: { signal?: AbortSignal },
): Promise<BindSkillResult> {
  const skillName = args.skill_name?.trim();
  if (!skillName) {
    return {
      success: false,
      message: 'Invalid input: skill_name is required and must be a non-empty string.',
      skill_name: '',
      applied_count: 0,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [],
      skipped_targets: [],
      error: 'INVALID_INPUT',
    };
  }

  let profile;
  try {
    profile = Profiles.get().activeSync();
  } catch {
    return {
      success: false,
      message: 'No current user session found. Please ensure you are logged in.',
      skill_name: skillName,
      applied_count: 0,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [],
      skipped_targets: [],
      error: 'NO_USER_SESSION',
    };
  }

  const isInstalled = !!profile.skills.get(skillName);
  if (!isInstalled) {
    return {
      success: false,
      message: `Skill "${skillName}" is not installed. Run "app skill install ${skillName}" first.`,
      skill_name: skillName,
      applied_count: 0,
      already_applied_count: 0,
      failed_count: 0,
      applied_targets: [],
      skipped_targets: [],
      error: 'SKILL_NOT_INSTALLED',
    };
  }

  const result: ApplySkillToAgentsResult = await applySkillToAgents({
    skillName,
    targets: args.targets,
    agentNames: args.agent_names,
    applyToAll: args.apply_to_all,
    requestSource: args.request_source ?? 'chat-tool',
  });

  return {
    success: result.success,
    message: result.message,
    skill_name: result.skillName,
    applied_count: result.appliedCount,
    already_applied_count: result.alreadyAppliedCount,
    failed_count: result.failedCount,
    applied_targets: result.appliedTargets,
    skipped_targets: result.skippedTargets,
    error: result.error,
  };
}
