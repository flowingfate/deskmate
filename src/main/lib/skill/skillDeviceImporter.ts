/**
 * Skill Device Importer
 * Handles importing skills from local device
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
import { parseSkillMarkdown } from './skillMetadata';
import { parseSkillFileName, determineVersion } from './skillVersion';
import { extractZip } from './skillArchive';
import {
  createTempDirectory,
  cleanupTempDirectory,
  validateSkillPackage,
  checkSkillExists,
  installSkill,
} from './skillInstall';
import type { ProfileStore } from '@main/persist';

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
    const { metadata, error } = parseSkillMarkdown(skillMdContent);
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

  const tempDir = createTempDirectory(tempPrefix);

  try {
    if (inputType === 'folder') {
      const sourceRoot = fs.statSync(inputPath).isDirectory() ? inputPath : path.dirname(inputPath);
      const { metadata, error } = readSkillMetadata(sourceRoot);
      if (!metadata || error) {
        throw new Error(error || 'Failed to parse skill metadata');
      }

      const extractedDir = stageSkillDirectory(sourceRoot, tempDir, metadata.name);
      const validation = validateSkillPackage(extractedDir, metadata.name);
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
    const { version: parsedVersion } = parseSkillFileName(zipFileName);
    const rootDirName = await extractZip(inputPath, tempDir);
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

    const validation = validateSkillPackage(extractedDir, metadata.name);
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
    cleanupTempDirectory(tempDir);
    throw error;
  }
}

/**
 * Add a skill from a local device
 */
export async function addSkillFromDevice(
  store: ProfileStore,
  inputPath: string,
  confirmCallback?: (skillName: string) => Promise<boolean>,
): Promise<AddSkillFromDeviceResult> {
  let preparedSource: PreparedSkillSource | null = null;

  try {
    logger.info({ msg: `[SkillDeviceImporter] Adding skill from device: ${inputPath}` });

    preparedSource = await prepareSkillSource(inputPath, 'device-skill');
    const { extractedDir, metadata, parsedVersion, inputType } = preparedSource;

    const existingSkill = checkSkillExists(store, metadata.name);
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

    const finalVersion = determineVersion(metadata.version, parsedVersion, existingSkill);
    logger.info({ msg: `[SkillDeviceImporter] Using version: ${finalVersion} (metadata: ${metadata.version || 'none'}, filename: ${parsedVersion || 'none'})` });

    logger.info({ msg: '[SkillDeviceImporter] Installing skill...' });

    const skillConfig = {
      name: metadata.name,
      description: metadata.description,
      version: finalVersion,
    };

    const installResult = await installSkill(store, skillConfig, extractedDir);

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
      cleanupTempDirectory(preparedSource.tempDir);
    }
  }
}

/**
 * Update a skill from a local device (auto-detects the target skill from the
 * package's own SKILL.md name; caller no longer pre-selects which skill to
 * update). Rejects when no installed skill matches that name — this is the
 * *only* gate, replacing the old target-name-must-match-caller-context check.
 */
export async function updateSkillFromDevice(
  store: ProfileStore,
  inputPath: string,
): Promise<AddSkillFromDeviceResult> {
  let preparedSource: PreparedSkillSource | null = null;

  try {
    logger.info({ msg: `[SkillDeviceImporter] Updating skill from device: ${inputPath}` });

    preparedSource = await prepareSkillSource(inputPath, 'update-skill');
    const { extractedDir, metadata, parsedVersion, inputType } = preparedSource;

    const existingSkill = checkSkillExists(store, metadata.name);

    if (!existingSkill) {
      return {
        success: false,
        error: `No installed skill named "${metadata.name}" was found. Use "Add from Device" to install a new skill instead.`
      };
    }

    const finalVersion = determineVersion(metadata.version, parsedVersion, existingSkill);
    logger.info({ msg: `[SkillDeviceImporter] Using version: ${finalVersion} (metadata: ${metadata.version || 'none'}, filename: ${parsedVersion || 'none'})` });

    logger.info({ msg: '[SkillDeviceImporter] Updating skill...' });

    const skillConfig = {
      name: metadata.name,
      description: metadata.description,
      version: finalVersion,
    };

    const installResult = await installSkill(store, skillConfig, extractedDir);

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
      cleanupTempDirectory(preparedSource.tempDir);
    }
  }
}