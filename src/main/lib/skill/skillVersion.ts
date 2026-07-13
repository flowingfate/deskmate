/**
 * Skill 名称校验、文件名解析与版本裁决
 */

import type { SkillValidationResult, VersionParseResult, SkillConfig } from './types';

const SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_SUFFIX = /^(.+)-(\d+\.\d+\.\d+)$/;

/**
 * 校验 skill 名称是否符合命名规则。
 * 仅允许数字 0-9、小写字母 a-z 及 "-"；"-" 不能位于首尾，且不允许空格。
 */
export function validateSkillName(name: string): SkillValidationResult {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Skill name cannot be empty' };
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return { valid: false, error: 'Skill name cannot start or end with "-"' };
  }
  if (name.includes(' ')) {
    return { valid: false, error: 'Skill name cannot contain spaces' };
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    return { valid: false, error: 'Skill name can only contain lowercase letters (a-z), numbers (0-9), and hyphens (-)' };
  }
  return { valid: true };
}

/**
 * 从 zip/skill 文件名中解析 skill 名称与版本号。
 * 支持格式：
 * 1. {skill-name}.zip
 * 2. {skill-name}-{version}.zip
 * 3. {skill-name}.skill（Claude 标准格式，本质为 zip）
 * 4. {skill-name}-{version}.skill
 */
export function parseSkillFileName(zipFileName: string): VersionParseResult {
  const nameWithoutExt = zipFileName.replace(/\.(zip|skill)$/i, '');
  const versionMatch = nameWithoutExt.match(SEMVER_SUFFIX);

  if (!versionMatch) {
    return { skillName: nameWithoutExt };
  }

  const skillName = versionMatch[1];
  const version = versionMatch[2];
  const versionParts = version.split('.');

  // SEMVER_SUFFIX 已保证三段数字，这里的复核为防御性冗余
  if (versionParts.length === 3 && versionParts.every(part => /^\d+$/.test(part))) {
    return { skillName, version };
  }
  return { skillName: nameWithoutExt };
}

/**
 * 裁决最终使用的版本号，优先级：
 * 1. SKILL.md metadata 中的 version 字段
 * 2. 从文件名解析出的版本号
 * 3. 无同名 skill → 默认 1.0.0
 * 4. 有同名 skill → 沿用其现有版本号
 */
export function determineVersion(
  metadataVersion?: string,
  parsedVersion?: string,
  existingSkill?: SkillConfig | null
): string {
  if (metadataVersion && metadataVersion.trim()) {
    return metadataVersion.trim();
  }
  if (parsedVersion) {
    return parsedVersion;
  }
  if (existingSkill) {
    return existingSkill.version || '1.0.0';
  }
  return '1.0.0';
}
