import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  ForeignSkillCandidate,
  ForeignSkillCategory,
  ForeignSkillSourceDefinition,
  ScanForeignAgentSkillsResult,
} from '@shared/types/skillTypes';

import { parseSkillMarkdown } from './skillMetadata';
import { validateSkillName } from './skillVersion';

const SKILL_ENTRY_FILE_NAMES = ['SKILL.md', 'skill.md'];

export const FOREIGN_SKILL_SOURCES: ForeignSkillSourceDefinition[] = [
  { id: 'claude-code', label: 'Claude Code', homeRelativePath: ['.claude', 'skills'] },
  { id: 'codex', label: 'Codex', homeRelativePath: ['.codex', 'skills'] },
  { id: 'cursor', label: 'Cursor', homeRelativePath: ['.cursor', 'skills'] },
  { id: 'agents', label: 'Agents', homeRelativePath: ['.agents', 'skills'] },
  { id: 'universal-agents', label: 'Universal Agents', homeRelativePath: ['.config', 'agents', 'skills'] },
  { id: 'opencode', label: 'OpenCode', homeRelativePath: ['.config', 'opencode', 'skills'] },
  { id: 'gemini-cli', label: 'Gemini CLI', homeRelativePath: ['.gemini', 'skills'] },
  { id: 'copilot', label: 'GitHub Copilot', homeRelativePath: ['.copilot', 'skills'] },
];

interface ParsedForeignSkill {
  name: string;
  description: string;
  version?: string;
  internal: boolean;
  valid: boolean;
  invalidReason?: string;
}

function getForeignSkillHomeRoot(): string {
  return process.env.DESKMATE_FOREIGN_SKILLS_HOME || os.homedir();
}

function getForeignSkillSourceRoot(source: ForeignSkillSourceDefinition): string {
  return path.join(getForeignSkillHomeRoot(), ...source.homeRelativePath);
}

/**
 * 判断导入 payload 的 `sourcePath` 是否落在某个已知来源根的**一级子目录**。
 * 用 `dirname === root`（而非 `startsWith`）死锁到一级，挡住 renderer 传来的
 * `~/.claude/skills/../../.ssh` 之类穿越。导入侧的安全复核咽喉。
 */
export function isAllowedForeignSkillPath(sourceId: string, sourcePath: string): boolean {
  const source = FOREIGN_SKILL_SOURCES.find((item) => item.id === sourceId);
  if (!source) {
    return false;
  }

  const sourceRoot = path.resolve(getForeignSkillSourceRoot(source));
  const resolvedSourcePath = path.resolve(sourcePath);
  return path.dirname(resolvedSourcePath) === sourceRoot;
}

/** 把绝对路径的 home 前缀缩成 `~`，用于 UI 展示与日志脱敏。 */
function toDisplayPath(absPath: string): string {
  const home = getForeignSkillHomeRoot();
  if (absPath === home) {
    return '~';
  }
  if (absPath.startsWith(home + path.sep)) {
    return `~${path.sep}${path.relative(home, absPath)}`;
  }
  return absPath;
}

/**
 * 脱敏 fs / parse 错误消息：Node 的 ENOENT/EACCES 文本里内嵌**未脱敏的绝对路径**
 * （含用户名），而这些串会随扫描结果过 IPC 进 renderer / 落日志。把其中的 home
 * 前缀整体替换成 `~`，与本文件其余路径展示纪律保持一致。
 */
function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const home = getForeignSkillHomeRoot();
  return home ? raw.split(home).join('~') : raw;
}

async function findSkillEntryPath(skillDir: string): Promise<string | null> {
  for (const fileName of SKILL_ENTRY_FILE_NAMES) {
    const candidate = path.join(skillDir, fileName);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* 不存在，试下一个大小写变体 */
    }
  }
  return null;
}

export async function readForeignSkillMetadata(
  skillDir: string,
): Promise<{ skill: ParsedForeignSkill | null; error?: string }> {
  const entryPath = await findSkillEntryPath(skillDir);
  if (!entryPath) {
    return { skill: null, error: 'SKILL.md file not found' };
  }

  try {
    const content = await fs.readFile(entryPath, 'utf-8');
    const { metadata, error } = parseSkillMarkdown(content);
    if (!metadata || error) {
      return { skill: null, error: error || 'Failed to parse skill metadata' };
    }

    const nameValidation = validateSkillName(metadata.name);
    return {
      skill: {
        name: metadata.name,
        description: metadata.description,
        version: typeof metadata.version === 'string' ? metadata.version : undefined,
        internal: metadata.internal === true,
        valid: nameValidation.valid,
        invalidReason: nameValidation.error,
      },
    };
  } catch (error) {
    return { skill: null, error: sanitizeErrorMessage(error) };
  }
}

function stableCandidateId(sourceId: string, sourcePath: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${sourceId}:${sourcePath}`)
    .digest('hex')
    .slice(0, 16);
  return `${sourceId}:${digest}`;
}

function makeCategory(
  source: ForeignSkillSourceDefinition,
  sourceRoot: string,
  fields: { exists: boolean; candidates: ForeignSkillCandidate[]; warnings: string[] },
): ForeignSkillCategory {
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    sourceRootDisplay: toDisplayPath(sourceRoot),
    ...fields,
  };
}

async function scanSource(source: ForeignSkillSourceDefinition): Promise<ForeignSkillCategory> {
  const sourceRoot = getForeignSkillSourceRoot(source);
  const warnings: string[] = [];
  const candidates: ForeignSkillCandidate[] = [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  } catch (error) {
    // 目录不存在是正常状态（用户没装该 Agent），不记 warning；其它错误（如权限）才记。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return makeCategory(source, sourceRoot, { exists: false, candidates, warnings });
    }
    warnings.push(sanitizeErrorMessage(error));
    return makeCategory(source, sourceRoot, { exists: true, candidates, warnings });
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const sourcePath = path.join(sourceRoot, entry.name);
    try {
      // stat（跟随软链）判目标是否为目录：skill 条目本身可能是指向别处的软链。
      const stat = await fs.stat(sourcePath);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch (error) {
      // 断链 / 权限：记 warning，只带条目名 + 脱敏消息。
      warnings.push(`${entry.name}: ${sanitizeErrorMessage(error)}`);
      continue;
    }

    const { skill, error } = await readForeignSkillMetadata(sourcePath);
    if (!skill) {
      // 「不是 skill 目录」静默跳过；「是 skill 但坏了」才 warn。
      if (error !== 'SKILL.md file not found') {
        warnings.push(`${entry.name}: ${error || 'Invalid skill metadata'}`);
      }
      continue;
    }

    if (skill.internal) {
      continue;
    }

    candidates.push({
      id: stableCandidateId(source.id, sourcePath),
      sourceId: source.id,
      sourcePath,
      sourcePathDisplay: toDisplayPath(sourcePath),
      name: skill.name,
      description: skill.description,
      version: skill.version,
      valid: skill.valid,
      invalidReason: skill.invalidReason,
      duplicateSourceCount: 1, // 单来源看不到全局重名，跨来源计数在 scanForeignAgentSkills 回填。
    });
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));

  return makeCategory(source, sourceRoot, { exists: true, candidates, warnings });
}

export async function scanForeignAgentSkills(): Promise<ScanForeignAgentSkillsResult> {
  try {
    const categories = await Promise.all(FOREIGN_SKILL_SOURCES.map(scanSource));

    // 跨来源重名统计：同名出现在多个来源时，各候选的 duplicateSourceCount > 1，
    // 交给 UI 做互斥选择（同一 target name 只能导入一个来源）。
    const nameCounts = new Map<string, number>();
    for (const category of categories) {
      for (const candidate of category.candidates) {
        nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
      }
    }
    for (const category of categories) {
      for (const candidate of category.candidates) {
        candidate.duplicateSourceCount = nameCounts.get(candidate.name) ?? 1;
      }
    }

    return {
      success: true,
      categories,
      warnings: categories.flatMap((category) =>
        category.warnings.map((warning) => `${category.sourceLabel}: ${warning}`),
      ),
    };
  } catch (error) {
    return {
      success: false,
      categories: [],
      warnings: [],
      error: sanitizeErrorMessage(error),
    };
  }
}
