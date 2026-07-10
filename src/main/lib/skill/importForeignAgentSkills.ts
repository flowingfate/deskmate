import { Profiles } from '@main/persist';
import { log } from '@main/log';
import type {
  ImportForeignAgentSkillsResult,
  ImportForeignSkillItem,
  ImportForeignSkillItemResult,
} from '@shared/types/skillTypes';
import type { ForeignSkillSourceId, SkillConfig } from '@shared/types/profileTypes';

import { addSkillFromDevice } from './skillDeviceImporter';
import { determineVersion } from './skillVersion';
import { linkSkill } from './skillInstall';
import {
  FOREIGN_SKILL_SOURCES,
  isAllowedForeignSkillPath,
  readForeignSkillMetadata,
} from './foreignAgentSkillScanner';

interface ResolvedImportItem {
  input: ImportForeignSkillItem;
  config: SkillConfig;
  existing: SkillConfig | null;
}

function sourceLabelFor(sourceId: ForeignSkillSourceId): string {
  return FOREIGN_SKILL_SOURCES.find((source) => source.id === sourceId)?.label ?? sourceId;
}

function failedResult(
  item: ImportForeignSkillItem,
  error: string,
  isOverwrite: boolean = false,
): ImportForeignSkillItemResult {
  return {
    candidateId: item.candidateId,
    installMode: item.installMode,
    success: false,
    isOverwrite,
    error,
  };
}

function successResult(
  item: ImportForeignSkillItem,
  skillName: string,
  isOverwrite: boolean,
): ImportForeignSkillItemResult {
  return {
    candidateId: item.candidateId,
    skillName,
    installMode: item.installMode,
    success: true,
    isOverwrite,
  };
}

async function resolveImportItems(items: ImportForeignSkillItem[]): Promise<{
  resolved: ResolvedImportItem[];
  failures: ImportForeignSkillItemResult[];
}> {
  const failures: ImportForeignSkillItemResult[] = [];
  const resolved: ResolvedImportItem[] = [];
  const profile = Profiles.get().activeSync();

  for (const item of items) {
    if (!isAllowedForeignSkillPath(item.sourceId, item.sourcePath)) {
      failures.push(failedResult(item, 'Source path is not in an allowed foreign agent skills directory'));
      continue;
    }

    const { skill, error } = await readForeignSkillMetadata(item.sourcePath);
    if (!skill || error) {
      failures.push(failedResult(item, error || 'Failed to read skill metadata'));
      continue;
    }

    if (!skill.valid) {
      failures.push(failedResult(item, skill.invalidReason || 'Invalid skill name'));
      continue;
    }

    if (skill.name !== item.selectedSkillName) {
      failures.push(failedResult(item, `Selected skill name "${item.selectedSkillName}" no longer matches source skill "${skill.name}"`));
      continue;
    }

    const existing = profile.skills.get(skill.name) ?? null;
    const finalVersion = determineVersion(skill.version, undefined, existing);
    const sourceLabel = sourceLabelFor(item.sourceId);
    const config: SkillConfig = {
      name: skill.name,
      description: skill.description,
      version: finalVersion,
      foreign: {
        kind: item.installMode,
        id: item.sourceId,
        label: sourceLabel,
        originalPath: item.sourcePath,
        importedAt: Date.now(),
      },
    };

    resolved.push({ input: item, config, existing });
  }

  return { resolved, failures };
}

function duplicateNameError(resolved: ResolvedImportItem[]): string | null {
  const seen = new Set<string>();
  for (const item of resolved) {
    if (seen.has(item.config.name)) {
      return `duplicate_selected_name: more than one selected item resolves to "${item.config.name}"`;
    }
    seen.add(item.config.name);
  }
  return null;
}

function summarize(results: ImportForeignSkillItemResult[], batchError?: string): ImportForeignAgentSkillsResult {
  const imported = results.filter((result) => result.success);
  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0 && !batchError,
    importedCount: imported.length,
    failedCount: failed.length,
    linkedCount: imported.filter((result) => result.installMode === 'link').length,
    copiedCount: imported.filter((result) => result.installMode === 'copy').length,
    overwrittenCount: imported.filter((result) => result.isOverwrite).length,
    results,
    error: batchError,
  };
}

async function importCopy(item: ResolvedImportItem): Promise<ImportForeignSkillItemResult> {
  const result = await addSkillFromDevice(item.input.sourcePath, async () => item.input.overwrite);
  if (!result.success || !result.skillName) {
    return failedResult(item.input, result.error || 'Failed to copy skill', item.existing !== null);
  }

  // addSkillFromDevice 已把 skill 复制到位并写入记录（skill 此刻已安装且可用，其 version
  // 计算含文件名 parsedVersion，更准）。这里只在其之上补 source provenance。
  // ⚠️ 这次 upsert 失败**不代表安装失败** —— skill 已装好，仅缺溯源字段。故降级为 warn +
  // 仍报 success，避免误报 failed 让用户以为没装（重试还会撞 checkSkillExists 卡死）。
  try {
    const profile = Profiles.get().activeSync();
    const written = profile.skills.get(result.skillName);
    await profile.skills.upsert({
      name: result.skillName,
      description: written?.description ?? item.config.description,
      version: written?.version ?? item.config.version,
      foreign: item.config.foreign,
    });
  } catch (error) {
    log.warn({
      msg: `[importForeignAgentSkills] Skill "${result.skillName}" copied but failed to record provenance`,
      err: error instanceof Error ? error : String(error),
    });
  }

  return successResult(item.input, result.skillName, item.existing !== null);
}

async function importLink(item: ResolvedImportItem): Promise<ImportForeignSkillItemResult> {
  const result = await linkSkill(item.config, item.input.sourcePath);
  if (!result.success) {
    return failedResult(item.input, result.error || 'Failed to link skill', item.existing !== null);
  }
  return successResult(item.input, item.config.name, item.existing !== null);
}

export async function importForeignAgentSkills(
  items: ImportForeignSkillItem[],
): Promise<ImportForeignAgentSkillsResult> {
  if (items.length === 0) {
    return summarize([]);
  }

  let resolved: ResolvedImportItem[];
  let failures: ImportForeignSkillItemResult[];
  try {
    const preflight = await resolveImportItems(items);
    resolved = preflight.resolved;
    failures = preflight.failures;
  } catch (error) {
    return summarize(
      items.map((item) => failedResult(item, error instanceof Error ? error.message : String(error))),
      error instanceof Error ? error.message : String(error),
    );
  }

  const duplicateError = duplicateNameError(resolved);
  if (duplicateError) {
    return summarize(
      items.map((item) => failedResult(item, duplicateError)),
      duplicateError,
    );
  }

  const results: ImportForeignSkillItemResult[] = [...failures];

  for (const item of resolved) {
    if (item.existing && !item.input.overwrite) {
      results.push(failedResult(item.input, `A skill named "${item.config.name}" is already installed`, true));
      continue;
    }

    if (item.input.installMode === 'link') {
      results.push(await importLink(item));
    } else {
      results.push(await importCopy(item));
    }
  }

  return summarize(results);
}
