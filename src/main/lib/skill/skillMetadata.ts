/**
 * SKILL.md YAML front-matter 解析与磁盘元数据读取
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '@main/log';
// @ts-ignore - js-yaml types may not be available
import * as yaml from 'js-yaml';
import type { SkillMetadata, MetadataParseResult } from './types';

const logger = log;

const YAML_FRONT_MATTER = /^---\s*\n([\s\S]*?)\n---/;

const EXPECTED_FORMAT_HINT =
  'Expected format:\n---\nname: skill-name\ndescription: "description"\n---';

/**
 * 解析 SKILL.md 文本，提取 YAML 元数据。
 * front-matter 必须从文件第 1 行的 `---` 开始。
 */
export function parseSkillMarkdown(content: string): MetadataParseResult {
  try {
    if (!content.startsWith('---')) {
      return {
        metadata: null,
        error: `YAML metadata must start from line 1 of SKILL.md (no empty lines or spaces before "---"). ${EXPECTED_FORMAT_HINT}`,
      };
    }

    const match = content.match(YAML_FRONT_MATTER);
    if (!match) {
      return {
        metadata: null,
        error: `SKILL.md does not contain valid YAML metadata. ${EXPECTED_FORMAT_HINT}`,
      };
    }

    const parsed = yaml.load(match[1]) as Record<string, unknown> | null | undefined;

    if (!parsed || typeof parsed !== 'object') {
      return { metadata: null, error: 'Invalid YAML metadata structure' };
    }

    const { name, description } = parsed;
    if (typeof name !== 'string' || !name.trim()) {
      return { metadata: null, error: 'SKILL.md metadata must contain a valid "name" field (lowercase)' };
    }
    if (typeof description !== 'string' || !description.trim()) {
      return { metadata: null, error: 'SKILL.md metadata must contain a valid "description" field (lowercase)' };
    }

    logger.info({ msg: `[SkillManager] Parsed skill metadata - name: "${name}", description: "${description}"` });

    return { metadata: parsed as SkillMetadata };
  } catch (error) {
    return { metadata: null, error: `Failed to parse YAML metadata: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * 读取某个 skill 目录下 SKILL.md 的元数据。
 */
export function getSkillMetadata(skillDir: string): MetadataParseResult {
  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return { metadata: null, error: 'SKILL.md file not found' };
    }

    const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
    return parseSkillMarkdown(skillMdContent);
  } catch (error) {
    return {
      metadata: null,
      error: `Failed to read skill metadata: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
