/**
 * Skill 子系统共享类型定义
 */

import type { SkillConfig } from '@shared/types/profileTypes';

export type { SkillConfig };

export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  // SKILL.md front-matter 允许携带任意额外字段（version、以及未来扩展）
  [key: string]: unknown;
}

export interface SkillValidationResult {
  valid: boolean;
  error?: string;
}

export interface VersionParseResult {
  skillName: string;
  version?: string;
}

export interface MetadataParseResult {
  metadata: SkillMetadata | null;
  error?: string;
}

export interface SkillOperationResult {
  success: boolean;
  error?: string;
  skillName?: string;
}
