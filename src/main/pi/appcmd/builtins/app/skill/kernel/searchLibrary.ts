/**
 * Skill 搜索内核 —— 跨 3 个 source 并发搜索(installed / clawhub / github),
 * 按优先级合并 + 按 name 去重(高优先级 source 胜出)。
 *
 * 角色:被 `appcmd/builtins/app/skill/search.ts` 调用。
 *
 * 3 个 source:
 *   1. installed —— 本地已装(可同时标 applied_to_current_agent)
 *   2. clawhub   —— clawhub.ai marketplace
 *   3. github    —— curated GitHub repo
 *
 * `Promise.allSettled` 保证单源失败不影响其它源;每条失败写到 `warnings`,
 * 即便所有源都挂也返回 success=true + 空 results,避免它在 catch 里乱重试。
 */

import { Profiles } from '@main/persist';
import { searchClawHubSkills } from '@main/lib/skill/clawHubSkillSearcher';
import { searchGitHubSkills } from '@main/lib/skill/githubSkillSearcher';

export type SkillSearchSource = 'installed' | 'clawhub' | 'github';

export interface SkillSearchResultItem {
  source: SkillSearchSource;
  metadata: {
    name: string;
    description: string;
    version?: string;
    applied_to_current_agent?: boolean;
    contact?: string;
    url?: string;
    repo?: string;
    local_folder?: string;
    score?: number;
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

function collect(
  outcome: PromiseSettledResult<SkillSearchResultItem[]>,
  warnings: string[],
  label: string,
): SkillSearchResultItem[] {
  if (outcome.status === 'fulfilled') return outcome.value;
  const detail = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
  warnings.push(`${label}: ${detail}`);
  return [];
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
    if (agent?.config.skills) {
      for (const s of agent.config.skills) appliedSkillNames.add(s);
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

async function searchClawHub(query: string): Promise<SkillSearchResultItem[]> {
  const clawHubResults = await searchClawHubSkills(query, 5);
  return clawHubResults.map<SkillSearchResultItem>((skill) => ({
    source: 'clawhub',
    metadata: {
      name: skill.name,
      description: skill.description,
      version: skill.version || undefined,
      url: skill.url,
      local_folder: skill.local_folder || undefined,
      score: skill.score,
    },
  }));
}

async function searchGitHub(query: string): Promise<SkillSearchResultItem[]> {
  const githubResults = await searchGitHubSkills(query, 5);
  return githubResults.map<SkillSearchResultItem>((skill) => ({
    source: 'github',
    metadata: {
      name: skill.name,
      description: skill.description,
      url: skill.url,
      repo: skill.repo,
      local_folder: skill.local_folder,
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
  const warnings: string[] = [];
  const currentAgentId = (args.current_agent_id || '').trim();

  const [installedOutcome, clawHubOutcome, githubOutcome] = await Promise.allSettled([
    searchInstalled(queryLower, currentAgentId),
    searchClawHub(query),
    searchGitHub(query),
  ]);

  const installedResults = collect(installedOutcome, warnings, 'Installed skills check failed');
  const clawHubResults = collect(clawHubOutcome, warnings, 'ClawHub search failed');
  const githubResults = collect(githubOutcome, warnings, 'GitHub repo search failed');

  // 按优先级合并 + 按 name 去重(高优先级 source 胜出)。
  const seenNames = new Set<string>();
  const results: SkillSearchResultItem[] = [];
  for (const list of [installedResults, clawHubResults, githubResults]) {
    for (const item of list) {
      if (seenNames.has(item.metadata.name)) continue;
      seenNames.add(item.metadata.name);
      results.push(item);
    }
  }

  if (results.length === 0) {
    const msg =
      warnings.length > 0
        ? `No skills found matching "${query}". Some sources failed: ${warnings.join('; ')}`
        : `No skills found matching "${query}".`;
    return {
      success: true,
      message: msg,
      results: [],
      total_count: 0,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  return {
    success: true,
    message: `Found ${results.length} skill(s) matching "${query}".`,
    results,
    total_count: results.length,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
