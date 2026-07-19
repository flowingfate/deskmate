/**
 * Skill 包完整性校验、安装/更新到 active profile，及临时目录管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
import type { ProfileStore } from '@main/persist';
import { PERSIST_PATH } from '@shared/persist/path';
import { getAppRoot } from '@main/persist/lib/root';
import { getTmpDir } from '@main/persist/lib/path';
import type { SkillConfig, SkillValidationResult, SkillOperationResult } from './types';
import { validateSkillName } from './skillVersion';
import { parseSkillMarkdown } from './skillMetadata';

const logger = log;

function removeSkillTargetIfExists(skillRootDir: string): void {
  try {
    const stat = fs.lstatSync(skillRootDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(skillRootDir);
      return;
    }
    fs.rmSync(skillRootDir, { recursive: true, force: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

function pathExists(pathToCheck: string): boolean {
  try {
    fs.lstatSync(pathToCheck);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function createSwapPath(skillName: string): string {
  const swapDir = path.join(getTmpDir(), 'skill-swaps');
  fs.mkdirSync(swapDir, { recursive: true });
  return path.join(swapDir, `${skillName}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
}

function createDirectoryLink(sourceDir: string, targetDir: string): void {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(sourceDir, targetDir, linkType);
}

interface SkillTargetSwap {
  commit(): void;
  rollback(): void;
}

/**
 * 用已准备好的新目标替换安装目录。旧内容先移入 app 管理的 tmp 目录；索引持久化失败时可原样恢复。
 */
function swapSkillTarget(stagedPath: string, targetPath: string, skillName: string): SkillTargetSwap {
  const backupPath = createSwapPath(skillName);
  const hasBackup = pathExists(targetPath);

  try {
    if (hasBackup) fs.renameSync(targetPath, backupPath);
    fs.renameSync(stagedPath, targetPath);
  } catch (error) {
    if (hasBackup && pathExists(backupPath)) {
      fs.renameSync(backupPath, targetPath);
    }
    throw error;
  }

  return {
    commit(): void {
      if (!hasBackup) return;
      try {
        removeSkillTargetIfExists(backupPath);
      } catch (error) {
        logger.error({
          msg: `[SkillManager] Failed to remove replaced skill backup: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    rollback(): void {
      removeSkillTargetIfExists(targetPath);
      if (hasBackup && pathExists(backupPath)) fs.renameSync(backupPath, targetPath);
    },
  };
}

/**
 * 校验 skill 包的完整性与合规性。
 */
export function validateSkillPackage(extractedDir: string, expectedName?: string): SkillValidationResult {
  try {
    // 1. 检查 SKILL.md 是否存在
    const skillMdPath = path.join(extractedDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return { valid: false, error: 'SKILL.md file not found in the skill package' };
    }

    // 2. 读取并解析 SKILL.md
    const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
    const { metadata, error: parseError } = parseSkillMarkdown(skillMdContent);
    if (!metadata || parseError) {
      return { valid: false, error: parseError || 'Failed to parse SKILL.md metadata' };
    }

    // 3. 若指定 expectedName，包内 name 必须精确匹配
    if (expectedName && metadata.name !== expectedName) {
      return {
        valid: false,
        error: `Skill package contains skill "${metadata.name}" but expected "${expectedName}"`,
      };
    }

    // 4. 若指定 expectedName，目录名必须与 skill 名一致
    if (expectedName && path.basename(extractedDir) !== metadata.name) {
      return {
        valid: false,
        error: `Directory name "${path.basename(extractedDir)}" must match skill name "${metadata.name}" from SKILL.md`,
      };
    }

    // 5. 校验 skill 名称合规
    const nameValidation = validateSkillName(metadata.name);
    if (!nameValidation.valid) {
      return { valid: false, error: nameValidation.error || 'Invalid skill name format' };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Skill package validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 检查明确 Profile 中是否已存在同名 skill。 */
export function checkSkillExists(store: ProfileStore, skillName: string): SkillConfig | null {
  return store.skills.get(skillName) ?? null;
}

/** 将 skill 安装/更新到明确 Profile。 */
export async function installSkill(
  store: ProfileStore,
  skillConfig: SkillConfig,
  sourceDir: string,
): Promise<SkillOperationResult> {
  try {
    if (!pathExists(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return { success: false, error: 'Source skill directory not found' };
    }

    const userSkillsDir = PERSIST_PATH.skillsDir(getAppRoot(), store.id);
    fs.mkdirSync(userSkillsDir, { recursive: true });
    const skillRootDir = path.join(userSkillsDir, skillConfig.name);
    const swap = swapSkillTarget(sourceDir, skillRootDir, skillConfig.name);

    try {
      await store.skills.upsert(skillConfig);
    } catch {
      swap.rollback();
      return { success: false, error: 'Failed to save skill configuration to profile' };
    }

    swap.commit();
    logger.info({ msg: `[SkillManager] Skill installed successfully: ${skillConfig.name}` });
    return { success: true, skillName: skillConfig.name };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `[SkillManager] Failed to install skill: ${errorMessage}` });
    return { success: false, error: errorMessage };
  }
}

/** 将外部 skill 目录以软链接 / junction 形式安装到明确 Profile。 */
export async function linkSkill(
  store: ProfileStore,
  skillConfig: SkillConfig,
  sourceDir: string,
): Promise<SkillOperationResult> {
  const stagedLink = createSwapPath(skillConfig.name);
  try {
    if (!pathExists(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return { success: false, error: 'Source skill directory not found' };
    }

    const userSkillsDir = PERSIST_PATH.skillsDir(getAppRoot(), store.id);
    fs.mkdirSync(userSkillsDir, { recursive: true });
    createDirectoryLink(sourceDir, stagedLink);

    const skillRootDir = path.join(userSkillsDir, skillConfig.name);
    const swap = swapSkillTarget(stagedLink, skillRootDir, skillConfig.name);
    try {
      await store.skills.upsert(skillConfig);
    } catch {
      swap.rollback();
      return { success: false, error: 'Failed to save skill configuration to profile' };
    }

    swap.commit();
    logger.info({ msg: `[SkillManager] Skill linked successfully: ${skillConfig.name}` });
    return { success: true, skillName: skillConfig.name };
  } catch (error) {
    removeSkillTargetIfExists(stagedLink);
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `[SkillManager] Failed to link skill: ${errorMessage}` });
    return { success: false, error: errorMessage };
  }
}

/**
 * 创建临时目录。
 */
export function createTempDirectory(prefix: string = 'deskmate-skill'): string {
  const tempDir = path.join(getTmpDir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * 清理临时目录。
 */
export function cleanupTempDirectory(dirPath: string): void {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      logger.info({ msg: `[SkillManager] Cleaned up temporary directory: ${dirPath}` });
    }
  } catch (error) {
    logger.error({ msg: `[SkillManager] Failed to cleanup directory: ${error instanceof Error ? error.message : String(error)}` });
  }
}
