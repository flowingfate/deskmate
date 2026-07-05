import { atom } from '@/atom';
import { ContextOption, ContextMenuOptionType, ContextMenuTriggerType, MentionScheme, filterSkillsByQuery, getDefaultMenuOptions } from '@/lib/chat/contextMentions';
import { searchWorkspaceFiles } from '@/lib/workspace/workspaceSearchService';
import { agentSessionCacheManager } from '@/lib/chat/agentSessionCacheManager';
import { ensureAgentDetail, getAgentDetailSync } from '@/states/agentDetail.atom';
import { getSkills as getSkillsAtom } from '@/states/skills.atom';
import { currentSessionStore } from '@/states/currentSession.atom';
import type { SkillConfig } from '@shared/types/profileTypes';
import { composeTextCommands } from './chatInputCommands';

/**
 * 取当前 agentId（与老 `profileDataManager.getCurrentChat()` 语义一致）。
 * 返 null 表示尚无激活 agent。
 */
function currentAgentId(): string | null {
  return agentSessionCacheManager.getCurrentAgentId();
}


/**
 * 取当前 agent 已绑定且全局存在的 skills（语义同老 getCurrentAgentSkills）。
 * cold 字段 skills 走 detail；await ensure 保证首次 # 触发也能命中。
 */
async function currentAgentSkills(): Promise<SkillConfig[]> {
  const id = currentAgentId();
  if (!id) return [];
  await ensureAgentDetail(id);
  const names = getAgentDetailSync(id)?.skills ?? [];
  const globalSkills = getSkillsAtom();
  return names
    .map((n) => globalSkills.find((s) => s.name === n))
    .filter((s): s is SkillConfig => !!s);
}

/**
 * Build a ContextOption for a file row inside `knowledge://` / `local://`
 * search results. `relPath` is the path returned by main IPC search (relative
 * to the resolved sandbox); the resulting URI is what the LLM will see in
 * the inserted `[@…]` mention.
 */
function buildFileOption(relPath: string, scheme: MentionScheme): ContextOption {
  const pathParts = relPath.split(/[\\/]/);
  const fileName = pathParts[pathParts.length - 1];
  const uri = `${scheme}://${relPath}`;
  return {
    type: scheme === 'knowledge'
      ? ContextMenuOptionType.Knowledge
      : ContextMenuOptionType.Local,
    relativePath: uri,
    fileName,
    description: `${scheme === 'knowledge' ? '[Knowledge] ' : '[Session] '}${relPath}`,
    value: uri,
  };
}


interface ContextMenuState {
  show: boolean;
  options: ContextOption[];
  selectedIndex: number;
  position: { top: number; left: number; width: number };
}


export const zeroContextMenuState: ContextMenuState = {
  show: false,
  options: [],
  selectedIndex: 0,
  position: { top: 0, left: 0, width: 0 },
};

export const ContextMenuAtom = atom(zeroContextMenuState, (get, set) => {
  function resetOptions(options: ContextOption[]) {
    set({ ...get(), selectedIndex: 0, options });
  }

  function closeMenu() {
    set(zeroContextMenuState);
  }

  async function selectMenu(option: ContextOption) {
    // 🆕 If a NoResults type option is selected, do nothing (it's just a hint)
    if (option.type === ContextMenuOptionType.NoResults) {
      // Close menu
      closeMenu();
      return;
    }

    // If it's a default option (no value), expand the file list for the corresponding source
    if (!option.value && !option.relativePath) {
      if (option.type === ContextMenuOptionType.Knowledge) {
        // List Knowledge Base files via `knowledge://` URI — wrapper resolves
        // to the active agent's KB sandbox (default `${agentRoot}/knowledge`
        // or user-overridden via `agent.config.knowledge.knowledgeBase`).
        try {
          if (!currentAgentId()) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No active agent',
              description: 'Open an agent to browse its knowledge base',
            }]);
            return;
          }
          const searchResult = await searchWorkspaceFiles({
            folder: 'knowledge://',
            pattern: undefined,
            maxResults: 100,
            fuzzy: false,
            searchTarget: 'files',
          });
          const results = searchResult.results;
          if (results.length === 0) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No files found',
              description: 'No files found in Knowledge Base',
            }]);
            return;
          }
          resetOptions(results.map((r) => buildFileOption(r.path, 'knowledge')));
        } catch (error) {
          resetOptions([{
            type: ContextMenuOptionType.NoResults,
            fileName: 'Failed to load Knowledge Base files',
            description: 'An error occurred while loading files',
          }]);
        }
        return;
      } else if (option.type === ContextMenuOptionType.Local) {
        // List session sandbox files via `local://` URI. Requires an active
        // session — `local://` resolution will throw without one.
        try {
          const cur = currentSessionStore.get();
          if (!cur.agentId || !cur.chatSessionId) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No active session',
              description: 'Open or create a session first',
            }]);
            return;
          }
          const sessionSearch = await searchWorkspaceFiles({
            folder: 'local://',
            pattern: undefined,
            maxResults: 100,
            fuzzy: false,
            searchTarget: 'files',
          });
          if (sessionSearch.results.length === 0) {
            resetOptions([{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No files in this session',
              description: 'Drop files into the chat or have the assistant generate one',
            }]);
            return;
          }
          resetOptions(sessionSearch.results.map((r) => buildFileOption(r.path, 'local')));
        } catch {
          resetOptions([{
            type: ContextMenuOptionType.NoResults,
            fileName: 'Failed to load Session files',
            description: 'An error occurred while loading files',
          }]);
        }
        return;
      }
    } else {
      // Options with actual values — route insertion command to the compose Textarea
      if (option.type === ContextMenuOptionType.Skill) {
        composeTextCommands.insertSkillMention(option.value ?? '');
      } else {
        composeTextCommands.insertMention(option);
      }
      // Close menu
      closeMenu();
    }
  }

  function hoverMenu(index: number) {
    set((prev) => ({ ...prev, selectedIndex: index }));
  }

  let timer = 0;
  async function triggerMenu(query: string, inputRect: DOMRect, triggerType?: ContextMenuTriggerType) {
    set({
      ...get(),
      show: true,
      // Calculate menu position: align with ChatInput, 2px above it
      position: {
        top: inputRect.top - 2, // 2px above ChatInput
        left: inputRect.left,
        width: inputRect.width,
      },
    });

  // Debounced search
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      try {
        // 🆕 Determine search logic based on trigger type
        if (triggerType === ContextMenuTriggerType.Skill) {
          // # trigger: search Skills
          const skills = await currentAgentSkills();
          let options: ContextOption[];

          if (skills.length === 0) {
            // No skills available
            options = [{
              type: ContextMenuOptionType.NoResults,
              fileName: 'No skills available for this agent',
              description: 'Add skills in Agent Settings',
            }];
          } else {
            // Filter skills by query
            options = filterSkillsByQuery(skills, query);

            if (options.length === 0 && query.trim().length > 0) {
              // 🆕 No matching results after filtering, show hint
              options = [{
                type: ContextMenuOptionType.NoResults,
                fileName: `No skills matching "${query}"`,
                description: `${skills.length} skills available`,
              }];
            } else if (options.length === 0) {
              // Show all skills when no search term
              options = skills.map((skill: { name: string; description?: string }) => ({
                type: ContextMenuOptionType.Skill,
                fileName: skill.name,
                description: skill.description || '',
                value: skill.name,
              }));
            }
          }

          resetOptions(options);
        } else {
          // @ trigger: search Knowledge Base and Chat Session Files via URI.
          // KB is reachable whenever an agent is active (handler falls back to
          // default `${agentRoot}/knowledge` when config field empty); local
          // sandbox requires an active session.
          const aid = currentAgentId();
          const cur = currentSessionStore.get();
          const hasAgent = !!aid;
          const hasChatSession = !!(cur.agentId && cur.chatSessionId);

          if (query.trim().length > 0) {
            const searchPromises: Promise<{ results: { path: string }[]; source: MentionScheme }>[] = [];

            if (hasAgent) {
              searchPromises.push(
                searchWorkspaceFiles({
                  folder: 'knowledge://',
                  pattern: query,
                  maxResults: 10,
                  fuzzy: true,
                  searchTarget: 'files',
                }).then(res => ({ results: res.results, source: 'knowledge' as MentionScheme }))
              );
            }

            if (hasChatSession) {
              searchPromises.push(
                searchWorkspaceFiles({
                  folder: 'local://',
                  pattern: query,
                  maxResults: 10,
                  fuzzy: true,
                  searchTarget: 'files',
                }).then(res => ({ results: res.results, source: 'local' as MentionScheme }))
              );
            }

            let options: ContextOption[] = [];

            if (searchPromises.length > 0) {
              const searchResults = await Promise.all(searchPromises);
              for (const { results, source } of searchResults) {
                for (const r of results) {
                  options.push(buildFileOption(r.path, source));
                }
              }
            }

            if (options.length === 0) {
              options = [{
                type: ContextMenuOptionType.NoResults,
                fileName: `No files matching "${query}"`,
                description: 'Try a different search term',
              }];
            }

            resetOptions(options);
          } else {
            // No search term (just typed @): show default options
            resetOptions(getDefaultMenuOptions());
          }
        }
      } catch (error) {
        if (triggerType === ContextMenuTriggerType.Skill) {
          resetOptions([{
            type: ContextMenuOptionType.NoResults,
            fileName: 'Failed to load skills',
            description: '',
          }]);
        } else {
          resetOptions(getDefaultMenuOptions());
        }
      }
    }, 200);
  }

  function navigateMenu(direction: 'up' | 'down') {
    const { options, selectedIndex: prev } = get();
    const len = options.length;
    if (len === 0) return;
    const next = direction === 'up' ? (prev - 1 + len) % len : (prev + 1) % len;
    set({ ...get(), selectedIndex: next });
  }

  return { closeMenu, selectMenu, hoverMenu, triggerMenu, navigateMenu }
});
