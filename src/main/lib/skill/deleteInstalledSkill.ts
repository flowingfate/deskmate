import * as fs from 'fs';
import * as path from 'path';
import { isBuiltinSkill } from '../../../shared/constants/builtinSkills';
import { Profiles } from '../../persist';
import { PERSIST_PATH } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';

export interface DeleteInstalledSkillResult {
  success: boolean;
  skillName: string;
  skillPath?: string;
  removedFromDisk: boolean;
  error?: 'BUILTIN_SKILL' | 'DELETE_PROFILE_FAILED' | 'DELETE_FILES_FAILED';
}

export async function deleteInstalledSkill(
  skillName: string,
): Promise<DeleteInstalledSkillResult> {
  const normalizedSkillName = skillName.trim();

  if (isBuiltinSkill(normalizedSkillName)) {
    return {
      success: false,
      skillName: normalizedSkillName,
      removedFromDisk: false,
      error: 'BUILTIN_SKILL',
    };
  }

  let profile;
  try {
    profile = Profiles.get().activeSync();
  } catch {
    return {
      success: false,
      skillName: normalizedSkillName,
      removedFromDisk: false,
      error: 'DELETE_FILES_FAILED',
    };
  }

  let deletedFromProfile = true;
  try {
    await profile.skills.remove(normalizedSkillName);
  } catch {
    deletedFromProfile = false;
  }
  if (!deletedFromProfile) {
    return {
      success: false,
      skillName: normalizedSkillName,
      removedFromDisk: false,
      error: 'DELETE_PROFILE_FAILED',
    };
  }

  const skillPath = path.join(PERSIST_PATH.skillsDir(getAppRoot(), profile.id), normalizedSkillName);

  try {
    const existedOnDisk = fs.existsSync(skillPath);
    if (existedOnDisk) {
      const stat = fs.lstatSync(skillPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(skillPath);
      } else {
        fs.rmSync(skillPath, { recursive: true, force: true });
      }
    }

    return {
      success: true,
      skillName: normalizedSkillName,
      skillPath,
      removedFromDisk: existedOnDisk,
    };
  } catch {
    return {
      success: false,
      skillName: normalizedSkillName,
      skillPath,
      removedFromDisk: false,
      error: 'DELETE_FILES_FAILED',
    };
  }
}
