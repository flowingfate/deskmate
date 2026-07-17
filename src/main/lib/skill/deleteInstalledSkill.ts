import type { ProfileStore } from '@main/persist';

export interface DeleteInstalledSkillResult {
  success: boolean;
  skillName: string;
  error?: 'DELETE_PROFILE_FAILED' | 'DELETE_FILES_FAILED';
}

/**
 * 卸载已安装 skill：从 profile skills 索引移除并删盘。
 *
 * 删盘由 `Skills.remove()` 独家负责（走 `removeDirIfExists` = `fs.rm(recursive, force)`）。
 * 对 linked skill（目录是指向外部的 symlink），`fs.rm` 只删链接、**不穿透**外部目标目录
 * （已实测；Node recursive rm 不跟随 symlink），故不会误伤 `~/.claude/skills/foo` 等源目录。
 * 本函数只负责错误映射，不重复做文件删除。
 */
export async function deleteInstalledSkill(
  store: ProfileStore,
  skillName: string,
): Promise<DeleteInstalledSkillResult> {
  const normalizedSkillName = skillName.trim();

  try {
    await store.skills.remove(normalizedSkillName);
  } catch {
    return {
      success: false,
      skillName: normalizedSkillName,
      error: 'DELETE_PROFILE_FAILED',
    };
  }

  return { success: true, skillName: normalizedSkillName };
}
