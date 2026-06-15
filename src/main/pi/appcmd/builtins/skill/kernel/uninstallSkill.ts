/**
 * Skill "uninstall" 内核 —— 批量卸载本地已安装 skill。**只删盘 + 全局 skill 配置**,
 * 不动 agent 配置(后者由 `unbind` 命令处理)。
 *
 * 角色:被 `appcmd/builtins/skill/uninstall.ts` 调用。
 *
 * 与老 `uninstallSkillsInternal` envelope 形态一致(uninstalled_count /
 * uninstalled_skills / skipped_skills)—— 直接搬过来,业务逻辑零调整。
 *
 * `signal` 仅做契约形状对齐 —— 卸载路径下没有可中断的 I/O。
 */

import { Profiles } from '@main/persist';
import { deleteInstalledSkill } from '@main/lib/skill/deleteInstalledSkill';

export interface UninstallSkillArgs {
  skill_names: string[];
}

export interface UninstallSkillResult {
  success: boolean;
  message: string;
  uninstalled_count: number;
  uninstalled_skills: string[];
  skipped_skills: Array<{ skill_name: string; reason: string }>;
  error?: string;
}

function normalizeSkillNames(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s): s is string => !!s),
    ),
  );
}

export async function uninstallSkillInternal(
  args: UninstallSkillArgs,
  _opts?: { signal?: AbortSignal },
): Promise<UninstallSkillResult> {
  const skillNames = normalizeSkillNames(args.skill_names || []);
  if (skillNames.length === 0) {
    return {
      success: false,
      message: 'Invalid input: skill_names must contain at least one non-empty string.',
      uninstalled_count: 0,
      uninstalled_skills: [],
      skipped_skills: [],
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
      uninstalled_count: 0,
      uninstalled_skills: [],
      skipped_skills: [],
      error: 'NO_USER_SESSION',
    };
  }

  const installedSkillNames = new Set(profile.skills.items.map((s) => s.name));
  const uninstalledSkills: string[] = [];
  const skippedSkills: Array<{ skill_name: string; reason: string }> = [];

  for (const skillName of skillNames) {
    if (!installedSkillNames.has(skillName)) {
      skippedSkills.push({ skill_name: skillName, reason: 'NOT_INSTALLED' });
      continue;
    }

    const deleteResult = await deleteInstalledSkill(skillName);
    if (deleteResult.success) {
      uninstalledSkills.push(skillName);
      installedSkillNames.delete(skillName);
    } else {
      skippedSkills.push({
        skill_name: skillName,
        reason: deleteResult.error === 'BUILTIN_SKILL' ? 'BUILTIN_SKILL' : 'DELETE_FAILED',
      });
    }
  }

  const success =
    skippedSkills.every((item) => item.reason !== 'DELETE_FAILED') && uninstalledSkills.length > 0;
  const message =
    uninstalledSkills.length > 0
      ? `Uninstalled ${uninstalledSkills.length} skill${uninstalledSkills.length === 1 ? '' : 's'} from the current profile. Agent skill references were not changed.`
      : 'No skills were uninstalled from the current profile.';

  return {
    success,
    message,
    uninstalled_count: uninstalledSkills.length,
    uninstalled_skills: uninstalledSkills,
    skipped_skills: skippedSkills,
    error: success ? undefined : uninstalledSkills.length === 0 ? 'NO_SKILLS_UNINSTALLED' : 'PARTIAL_FAILURE',
  };
}
