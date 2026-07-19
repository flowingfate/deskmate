/**
 * Skill "list" 内核 —— 列出 owning Profile 内所有已安装 skill。
 *
 * 角色:被 `appcmd/builtins/app/skill/list.ts` 复用。
 *
 * 与 `agent/kernel/listAgents.ts` 同设计:envelope 包含 name + 简要元信息,
 * 让 LLM 一次拿全(version / source / description),避免后续 N 次 status 调用。
 *
 * 失败不抛,通过 envelope 回流;`signal` 仅做契约形状对齐。
 */

import type { ProfileStore } from '@main/persist';

export interface SkillListItem {
  name: string;
  description: string;
  version: string;
}

export interface ListSkillsResult {
  success: boolean;
  skills: SkillListItem[];
  count: number;
  message: string;
  error?: string;
}

export async function listSkillsInternal(
  store: ProfileStore,
  _opts?: { signal?: AbortSignal },
): Promise<ListSkillsResult> {
  try {
    const items = store.skills.items;
    const skills: SkillListItem[] = items.map((s) => ({
      name: s.name,
      description: s.description,
      version: s.version,
    }));

    return {
      success: true,
      skills,
      count: skills.length,
      message:
        skills.length > 0
          ? `Found ${skills.length} installed skill(s).`
          : 'No skills installed in the owning profile.',
    };
  } catch (error) {
    return {
      success: false,
      skills: [],
      count: 0,
      message: `Error listing skills: ${error instanceof Error ? error.message : String(error)}`,
      error: 'LIST_FAILED',
    };
  }
}
