/**
 * Skill "unbind" 内核 —— 把 skill 从 agent 配置里解绑。**不**卸载本地包(由
 * `uninstall` 负责)。
 *
 * 角色:被 `appcmd/builtins/skill/unbind.ts` 调用。
 *
 * 默认 agent 解析(空 target → 当前 agent)由 CLI 层处理,kernel 不读 ctx。
 *
 * `signal` 仅做契约形状对齐 —— 该路径下持久化是同步快路径。
 */

import {
  removeSkillsFromAgents,
  type RemoveSkillsFromAgentsResult,
  type SkillAgentTarget,
} from '@main/lib/skill/removeSkillsFromAgents';

export interface UnbindSkillArgs {
  /** 一次 unbind 一个或多个 skill。 */
  skill_names: string[];
  targets?: SkillAgentTarget[];
  agent_names?: string[];
  remove_from_all?: boolean;
}

export interface UnbindSkillResult {
  success: boolean;
  message: string;
  skill_names: string[];
  updated_agent_count: number;
  removed_binding_count: number;
  unchanged_target_count: number;
  failed_count: number;
  updated_targets: Array<SkillAgentTarget & { removedSkills: string[] }>;
  skipped_targets: Array<SkillAgentTarget & { reason: string }>;
  error?: string;
}

function normalizeSkillNames(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s): s is string => !!s),
    ),
  );
}

export async function unbindSkillInternal(
  args: UnbindSkillArgs,
  _opts?: { signal?: AbortSignal },
): Promise<UnbindSkillResult> {
  const skillNames = normalizeSkillNames(args.skill_names);
  if (skillNames.length === 0) {
    return {
      success: false,
      message: 'Invalid input: skill_names must contain at least one non-empty string.',
      skill_names: [],
      updated_agent_count: 0,
      removed_binding_count: 0,
      unchanged_target_count: 0,
      failed_count: 0,
      updated_targets: [],
      skipped_targets: [],
      error: 'INVALID_INPUT',
    };
  }

  const result: RemoveSkillsFromAgentsResult = await removeSkillsFromAgents({
    skillNames,
    targets: args.targets,
    agentNames: args.agent_names,
    removeFromAll: args.remove_from_all,
  });

  return {
    success: result.success,
    message: result.message,
    skill_names: result.skillNames,
    updated_agent_count: result.updatedAgentCount,
    removed_binding_count: result.removedBindingCount,
    unchanged_target_count: result.unchangedTargetCount,
    failed_count: result.failedCount,
    updated_targets: result.updatedTargets,
    skipped_targets: result.skippedTargets,
    error: result.error,
  };
}
