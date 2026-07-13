/**
 * Skill "status" 内核 —— 查询 skill 在当前 profile 中的状态。
 *
 * 角色:被 `appcmd/builtins/app/skill/status.ts` 调用,与 `agent/kernel/getStatus.ts` 对称。
 *
 * 状态枚举:
 *   - NotInstalled —— 不在 active profile 的 skills.items 里
 *   - Installed    —— 已装,附 version / source / 当前 agent 是否绑定该 skill
 *
 * `signal` 仅做契约形状对齐。
 */

import { Profiles } from '@main/persist';

export type SkillStatus = 'NotInstalled' | 'Installed';

export interface GetSkillStatusArgs {
  skill_name: string;
  /** 当前 agent id —— 用来标 `applied_to_current_agent`。空字符串表示无 chat context。 */
  current_agent_id?: string;
}

export interface GetSkillStatusResult {
  success: boolean;
  skill_name: string;
  status: SkillStatus;
  message: string;
  details?: {
    version?: string;
    description?: string;
    applied_to_current_agent?: boolean;
  };
  error?: string;
}

export async function getSkillStatusInternal(
  args: GetSkillStatusArgs,
  _opts?: { signal?: AbortSignal },
): Promise<GetSkillStatusResult> {
  try {
    const raw = args.skill_name;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      return {
        success: false,
        skill_name: raw || '',
        status: 'NotInstalled',
        message: 'Invalid input: skill_name is required and must be a non-empty string.',
        error: 'INVALID_INPUT',
      };
    }
    const skillName = raw.trim();

    const profile = await Profiles.get().active();
    const installed = profile.skills.get(skillName);

    if (!installed) {
      return {
        success: true,
        skill_name: skillName,
        status: 'NotInstalled',
        message: `Skill "${skillName}" is not installed.`,
      };
    }

    let appliedToCurrent: boolean | undefined;
    if (args.current_agent_id && args.current_agent_id.trim()) {
      const agent = await profile.getAgent(args.current_agent_id.trim());
      appliedToCurrent = (agent?.config.skills ?? {})[skillName] !== undefined;
    }

    return {
      success: true,
      skill_name: skillName,
      status: 'Installed',
      message: `Skill "${skillName}" is installed.`,
      details: {
        version: installed.version,
        description: installed.description,
        applied_to_current_agent: appliedToCurrent,
      },
    };
  } catch (error) {
    return {
      success: false,
      skill_name: args.skill_name || '',
      status: 'NotInstalled',
      message: `Error checking skill status: ${error instanceof Error ? error.message : String(error)}`,
      error: 'STATUS_FAILED',
    };
  }
}
