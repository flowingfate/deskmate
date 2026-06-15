/**
 * Skill Device Importer
 * Handles importing skills from local device
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
import { skillManager } from './skillManager';

const logger = log;

export type SkillDeviceInputType = 'zip' | 'skill' | 'folder';

export interface AddSkillFromDeviceResult {
  success: boolean;
  error?: string;
  skillName?: string;
  skillVersion?: string;
  isOverwrite?: boolean;
  inputType?: SkillDeviceInputType;
}

interface PreparedSkillSource {
  tempDir: string;
  extractedDir: string;
  metadata: {
    name: string;
    description: string;
    version?: string;
  };
  inputType: SkillDeviceInputType;
  parsedVersion?: string;
}

function getSkillEntryPath(skillDir: string): string | null {
  const canonicalPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(canonicalPath)) {
    return canonicalPath;
  }

  const lowercasePath = path.join(skillDir, 'skill.md');
  if (fs.existsSync(lowercasePath)) {
    return lowercasePath;
  }

  return null;
}

function normalizeSkillEntryFile(skillDir: string): void {
  const canonicalPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(canonicalPath)) {
    return;
  }

  const lowercasePath = path.join(skillDir, 'skill.md');
  if (fs.existsSync(lowercasePath)) {
    fs.renameSync(lowercasePath, canonicalPath);
  }
}

function getInputType(inputPath: string): SkillDeviceInputType | null {
  if (!fs.existsSync(inputPath)) {
    return null;
  }

  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    return 'folder';
  }

  const lowerPath = inputPath.toLowerCase();
  if (lowerPath.endsWith('.zip')) {
    return 'zip';
  }

  if (lowerPath.endsWith('.skill')) {
    return 'skill';
  }

  return null;
}

function readSkillMetadata(skillDir: string): { metadata: { name: string; description: string; version?: string } | null; error?: string } {
  const entryPath = getSkillEntryPath(skillDir);
  if (!entryPath) {
    return { metadata: null, error: 'SKILL.md file not found' };
  }

  try {
    const skillMdContent = fs.readFileSync(entryPath, 'utf-8');
    const { metadata, error } = skillManager.parseSkillMarkdown(skillMdContent);
    if (!metadata || error) {
      return { metadata: null, error: error || 'Failed to parse skill metadata' };
    }

    return {
      metadata: {
        name: metadata.name,
        description: metadata.description,
        version: typeof metadata.version === 'string' ? metadata.version : undefined,
      },
    };
  } catch (error) {
    return {
      metadata: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function stageSkillDirectory(sourceDir: string, tempDir: string, skillName: string): string {
  const stagedDir = path.join(tempDir, skillName);
  if (fs.existsSync(stagedDir)) {
    fs.rmSync(stagedDir, { recursive: true, force: true });
  }

  fs.cpSync(sourceDir, stagedDir, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  normalizeSkillEntryFile(stagedDir);
  return stagedDir;
}

async function prepareSkillSource(inputPath: string, tempPrefix: string): Promise<PreparedSkillSource> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Path does not exist: ${inputPath}`);
  }

  const inputType = getInputType(inputPath);
  if (!inputType) {
    throw new Error('Unsupported skill input. Expected a .zip, .skill, or skill folder.');
  }

  const tempDir = skillManager.createTempDirectory(tempPrefix);

  try {
    if (inputType === 'folder') {
      const sourceRoot = fs.statSync(inputPath).isDirectory() ? inputPath : path.dirname(inputPath);
      const { metadata, error } = readSkillMetadata(sourceRoot);
      if (!metadata || error) {
        throw new Error(error || 'Failed to parse skill metadata');
      }

      const extractedDir = stageSkillDirectory(sourceRoot, tempDir, metadata.name);
      const validation = skillManager.validateSkillPackage(extractedDir, metadata.name);
      if (!validation.valid) {
        throw new Error(validation.error || 'Skill validation failed');
      }

      return {
        tempDir,
        extractedDir,
        metadata,
        inputType,
      };
    }

    const zipFileName = path.basename(inputPath);
    const { version: parsedVersion } = skillManager.parseSkillFileName(zipFileName);
    const rootDirName = await skillManager.extractZip(inputPath, tempDir);
    const initialExtractedDir = path.join(tempDir, rootDirName);
    const { metadata, error } = readSkillMetadata(initialExtractedDir);
    if (!metadata || error) {
      throw new Error(error || 'Failed to parse skill metadata');
    }

    const extractedDir = initialExtractedDir === path.join(tempDir, metadata.name)
      ? initialExtractedDir
      : (() => {
          const normalizedDir = path.join(tempDir, metadata.name);
          if (fs.existsSync(normalizedDir)) {
            fs.rmSync(normalizedDir, { recursive: true, force: true });
          }
          fs.renameSync(initialExtractedDir, normalizedDir);
          return normalizedDir;
        })();

    normalizeSkillEntryFile(extractedDir);

    const validation = skillManager.validateSkillPackage(extractedDir, metadata.name);
    if (!validation.valid) {
      throw new Error(validation.error || 'Skill validation failed');
    }

    return {
      tempDir,
      extractedDir,
      metadata,
      inputType,
      parsedVersion,
    };
  } catch (error) {
    skillManager.cleanupTempDirectory(tempDir);
    throw error;
  }
}

/**
 * Add a skill from a local device
 */
export async function addSkillFromDevice(
  inputPath: string,
  confirmCallback?: (skillName: string) => Promise<boolean>
): Promise<AddSkillFromDeviceResult> {
  let preparedSource: PreparedSkillSource | null = null;

  try {
    logger.info({ msg: `[SkillDeviceImporter] Adding skill from device: ${inputPath}` });

    preparedSource = await prepareSkillSource(inputPath, 'device-skill');
    const { extractedDir, metadata, parsedVersion, inputType } = preparedSource;

    const existingSkill = await skillManager.checkSkillExists(metadata.name);
    if (existingSkill) {
      logger.info({ msg: `[SkillDeviceImporter] Found existing skill "${metadata.name}", requesting user confirmation` });

      if (confirmCallback) {
        const userConfirmed = await confirmCallback(metadata.name);
        if (!userConfirmed) {
          return { success: false, error: 'User cancelled the operation' };
        }
      } else {
        return {
          success: false,
          error: `A skill with the name "${metadata.name}" is already installed. Use confirmation callback to handle overwrite.`
        };
      }
    }

    const finalVersion = skillManager.determineVersion(
      metadata.version,
      parsedVersion,
      existingSkill
    );
    logger.info({ msg: `[SkillDeviceImporter] Using version: ${finalVersion} (metadata: ${metadata.version || 'none'}, filename: ${parsedVersion || 'none'})` });

    logger.info({ msg: '[SkillDeviceImporter] Installing skill...' });

    const skillConfig = {
      name: metadata.name,
      description: metadata.description,
      version: finalVersion,
    };

    const installResult = await skillManager.installSkill(
      skillConfig,
      extractedDir,
      !!existingSkill
    );

    if (!installResult.success) {
      return { success: false, error: installResult.error };
    }

    logger.info({ msg: `[SkillDeviceImporter] Skill installed successfully: ${metadata.name}` });
    return {
      success: true,
      skillName: metadata.name,
      skillVersion: finalVersion,
      isOverwrite: !!existingSkill,
      inputType,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `[SkillDeviceImporter] Failed to add skill from device: ${errorMessage}` });
    return { success: false, error: errorMessage };
  } finally {
    if (preparedSource?.tempDir) {
      skillManager.cleanupTempDirectory(preparedSource.tempDir);
    }
  }
}

/**
 * Update a skill from a local device (dedicated to update operations, includes skill name validation)
 */
export async function updateSkillFromDevice(
  inputPath: string,
  targetSkillName: string,
  validateSkillNameCallback?: (detectedSkillName: string) => Promise<boolean>,
  confirmCallback?: (skillName: string) => Promise<boolean>
): Promise<AddSkillFromDeviceResult> {
  let preparedSource: PreparedSkillSource | null = null;

  try {
    logger.info({ msg: `[SkillDeviceImporter] Updating skill from device: ${inputPath}, target: ${targetSkillName}` });

    preparedSource = await prepareSkillSource(inputPath, 'update-skill');
    const { extractedDir, metadata, parsedVersion, inputType } = preparedSource;

    if (validateSkillNameCallback) {
      const nameValidationResult = await validateSkillNameCallback(metadata.name);
      if (!nameValidationResult) {
        return {
          success: false,
          error: `Validation failed: The selected skill artifact contains skill "${metadata.name}" but you are trying to update skill "${targetSkillName}". Please select the correct artifact or folder for skill "${targetSkillName}".`
        };
      }
    } else {
      if (metadata.name !== targetSkillName) {
        return {
          success: false,
          error: `Validation failed: The selected skill artifact contains skill "${metadata.name}" but you are trying to update skill "${targetSkillName}". Please select the correct artifact or folder for skill "${targetSkillName}".`
        };
      }
    }

    const existingSkill = await skillManager.checkSkillExists(metadata.name);

    if (!existingSkill) {
      return {
        success: false,
        error: `Cannot update skill "${metadata.name}" because it does not exist. Use "Add from Device" to install it first.`
      };
    }

    if (confirmCallback) {
      const userConfirmed = await confirmCallback(metadata.name);
      if (!userConfirmed) {
        return { success: false, error: 'User cancelled the operation' };
      }
    }

    const finalVersion = skillManager.determineVersion(
      metadata.version,
      parsedVersion,
      existingSkill
    );
    logger.info({ msg: `[SkillDeviceImporter] Using version: ${finalVersion} (metadata: ${metadata.version || 'none'}, filename: ${parsedVersion || 'none'})` });

    logger.info({ msg: '[SkillDeviceImporter] Updating skill...' });

    const skillConfig = {
      name: metadata.name,
      description: metadata.description,
      version: finalVersion,
    };

    const installResult = await skillManager.installSkill(
      skillConfig,
      extractedDir,
      true
    );

    if (!installResult.success) {
      return { success: false, error: installResult.error };
    }

    logger.info({ msg: `[SkillDeviceImporter] Skill updated successfully: ${metadata.name}` });
    return { success: true, skillName: metadata.name, skillVersion: finalVersion, inputType };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ msg: `[SkillDeviceImporter] Failed to update skill from device: ${errorMessage}` });
    return { success: false, error: errorMessage };
  } finally {
    if (preparedSource?.tempDir) {
      skillManager.cleanupTempDirectory(preparedSource.tempDir);
    }
  }
}