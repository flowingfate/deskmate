/**
 * Skill 搜索内核 —— 仅查询本地 installed 源(profile 已安装的 skill 列表),
 * 按 name/description 关键字过滤,可选标注 applied_to_current_agent。
 *
 * 角色:被 `appcmd/builtins/app/skill/search.ts` 调用。
 *
 * 历史备注:曾经跨 installed / clawhub(ClawHub marketplace) / github(curated repo)
 * 3 个 source 并发搜索;远程发现功能已整体移除,现在只保留本地 installed 搜索。
 * `source` 字段与 `SkillSearchSource` 类型因此收窄为单一字面量 `'installed'`,
 * 保留是为了不破坏调用方(`search.ts`)对结果 shape 的既有假设。
 */

import { Profiles } from '@main/persist';

export type SkillSearchSource = 'installed';

export interface SkillSearchResultItem {
  source: SkillSearchSource;
  metadata: {
    name: string;
    description: string;
    version?: string;
    applied_to_current_agent?: boolean;
  };
}

export interface SearchLibraryResult {
  success: boolean;
  message: string;
  results: SkillSearchResultItem[];
  total_count: number;
  warnings?: string[];
  error?: string;
}

export interface SearchLibraryArgs {
  query: string;
  /** 当前 agent id —— 用来标 installed 源里的 applied_to_current_agent。空 = 无 chat。 */
  current_agent_id?: string;
}

async function searchInstalled(
  queryLower: string,
  currentAgentId: string,
): Promise<SkillSearchResultItem[]> {
  const profile = await Profiles.get().active();
  const installedSkills = profile.skills.items;

  const appliedSkillNames = new Set<string>();
  if (currentAgentId) {
    const agent = await profile.getAgent(currentAgentId);
    const bindings = agent?.config.skills;
    if (bindings) {
      for (const s of Object.keys(bindings)) appliedSkillNames.add(s);
    }
  }

  const matches = installedSkills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(queryLower) ||
      skill.description.toLowerCase().includes(queryLower),
  );

  return matches.map<SkillSearchResultItem>((skill) => ({
    source: 'installed',
    metadata: {
      name: skill.name,
      description: skill.description,
      version: skill.version,
      applied_to_current_agent: appliedSkillNames.has(skill.name),
    },
  }));
}

export async function searchLibraryInternal(
  args: SearchLibraryArgs,
): Promise<SearchLibraryResult> {
  const raw = args.query;
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return {
      success: false,
      message: 'Invalid input: query is required and must be a non-empty string.',
      results: [],
      total_count: 0,
      error: 'INVALID_INPUT',
    };
  }

  const query = raw.trim();
  const queryLower = query.toLowerCase();
  const currentAgentId = (args.current_agent_id || '').trim();
  const warnings: string[] = [];

  // 单一 source,不再需要 Promise.allSettled 跨源容错;
  // 仍然吞掉异常写入 warnings(而非直接抛出),保持“查询失败也返回 success=true”的既有契约。
  let results: SkillSearchResultItem[] = [];
  try {
    results = await searchInstalled(queryLower, currentAgentId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push(`Installed skills check failed: ${detail}`);
  }

  if (results.length === 0) {
    const msg =
      warnings.length > 0
        ? `No skills found matching "${query}". Search failed: ${warnings.join('; ')}`
        : `No skills found matching "${query}".`;
    return {
      success: true,
      message: msg,
      results: [],
      total_count: 0,
      warnings,
    };
  }

  return {
    success: true,
    message: `Found ${results.length} skill(s) matching "${query}".`,
    results,
    total_count: results.length,
    warnings,
  };
}
