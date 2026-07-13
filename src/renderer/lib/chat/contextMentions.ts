/**
 * Context Mentions utility functions
 *
 * 统一 mention 形态:
 *   [@knowledge://<path>]  → 当前 agent KB 内文件
 *   [@local://<path>]      → 当前 session sandbox 内文件
 *   [@skill://<name>]      → 当前 agent 绑定的 skill
 */

/** 唯一 mention 匹配:`[@(knowledge|local)://...]`,捕获 scheme prefix + 内部路径。 */
export const mentionRegex = /\[@(knowledge:\/\/|local:\/\/)([^\]]+)\]/g;


/** Mention scheme,由 URI prefix 决定。 */
export type MentionScheme = 'knowledge' | 'local';


// Context menu option types
export enum ContextMenuOptionType {
  File = 'file',
  Folder = 'folder',
  Skill = 'skill',
  Knowledge = 'knowledge',   // [@knowledge://...]
  Local = 'local',           // [@local://...]
  NoResults = 'no-results'
}

// Context option interface
export interface ContextOption {
  type: ContextMenuOptionType;
  relativePath?: string;   // 内部相对路径(可选;default options 没有)
  fileName: string;        // 显示名
  description?: string;    // 附加描述
  /** Full mention URI(`knowledge://...` / `local://...` / `skill://...`)。 */
  value?: string;
}

/**
 * 默认菜单项(刚敲 `@` 还没有输入查询时显示)。
 */
export function getDefaultMenuOptions(): ContextOption[] {
  return [
    {
      type: ContextMenuOptionType.Knowledge,
      fileName: 'Add Knowledge File',
      description: 'Browse and select knowledge base files',
      value: undefined, // no value → 触发 file picker
    },
    {
      type: ContextMenuOptionType.Local,
      fileName: 'Add Chat Session File',
      description: 'Browse and select current chat session deliverables',
      value: undefined,
    },
    {
      type: ContextMenuOptionType.Skill,
      fileName: 'Add Skill',
      description: 'Reference a skill bound to this agent',
      value: undefined, // no value → 展开当前 agent 绑定的 skill 列表
    },
  ];
}

/**
 * 当前光标是否处在 `@` 触发的菜单上下文中(唯一触发键)。
 * 已落在某个 mention 内部(`knowledge://` / `local://` / `skill://`)则不重触发。
 */
export function shouldShowContextMenu(text: string, cursorPos: number): boolean {
  const beforeCursor = text.slice(0, cursorPos);
  const lastAtIndex = beforeCursor.lastIndexOf('@');
  if (lastAtIndex === -1) return false;
  const textAfterAt = beforeCursor.slice(lastAtIndex + 1);
  // 已在一个 mention 内部 —— 不再重触发菜单。
  if (
    textAfterAt.startsWith('knowledge://') ||
    textAfterAt.startsWith('local://') ||
    textAfterAt.startsWith('skill://')
  ) {
    return false;
  }
  return !/\s/.test(textAfterAt);
}

/** @ 触发时,光标到 `@` 之间的查询串。 */
export function getCurrentSearchQuery(text: string, cursorPos: number): string {
  const beforeCursor = text.slice(0, cursorPos);
  const lastAtIndex = beforeCursor.lastIndexOf('@');
  if (lastAtIndex === -1) return '';
  return beforeCursor.slice(lastAtIndex + 1);
}

/**
 * 把光标所在位置(往左 `@` 起到光标)替换为 `[@<uri>] `。
 *
 * `uri` 形如 `knowledge://foo.md` 或 `local://bar.tsx`。Caller 由 ContextOption.value
 * 直接提供 —— option.value 是完整 URI。
 */
export function insertMention(
  text: string,
  cursorPos: number,
  uri: string,
): { newText: string; newCursorPos: number } {
  const safeCursorPos = Math.min(Math.max(0, cursorPos), text.length);
  const beforeCursor = text.slice(0, safeCursorPos);
  const afterCursor = text.slice(safeCursorPos);
  const lastAtIndex = beforeCursor.lastIndexOf('@');

  if (lastAtIndex !== -1) {
    const beforeMention = text.slice(0, lastAtIndex);
    const mention = `[@${uri}]`;
    const newText = `${beforeMention}${mention} ${afterCursor}`;
    const newCursorPos = lastAtIndex + mention.length + 1; // mention + trailing space
    return { newText, newCursorPos };
  }

  return { newText: text, newCursorPos: safeCursorPos };
}

/**
 * 删除光标紧邻左侧的完整 `[@knowledge://...]` 或 `[@local://...]` mention。
 * 找不到则原样返回。
 */
export function removeMention(
  text: string,
  cursorPos: number,
): { newText: string; newCursorPos: number } {
  const beforeCursor = text.slice(0, cursorPos);
  const match = beforeCursor.match(/\[@(?:knowledge:\/\/|local:\/\/)[^\]]+\]$/);

  if (match) {
    const mentionLength = match[0].length;
    const newText = text.slice(0, cursorPos - mentionLength) + text.slice(cursorPos);
    return { newText, newCursorPos: cursorPos - mentionLength };
  }

  return { newText: text, newCursorPos: cursorPos };
}

/**
 * 抽取 message 内所有 mention,按出现顺序返回 `{ scheme, path }` 列表。
 */
export function extractMentions(text: string): Array<{ scheme: MentionScheme; path: string }> {
  const out: Array<{ scheme: MentionScheme; path: string }> = [];
  const regex = new RegExp(mentionRegex);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    // m[1] 是 "knowledge://" 或 "local://" —— 去掉 "://" 得到 scheme。
    const scheme = match[1].slice(0, -3) as MentionScheme;
    out.push({ scheme, path: match[2] });
  }
  return out;
}


/**
 * 按 query 过滤 skill 列表,组装成菜单 options。
 */
export function filterSkillsByQuery(
  skills: Array<{ name: string; description?: string; version?: string }>,
  query: string,
): ContextOption[] {
  const lowerQuery = query.toLowerCase();
  return skills
    .filter(skill => skill.name.toLowerCase().includes(lowerQuery))
    .map(skill => ({
      type: ContextMenuOptionType.Skill,
      fileName: skill.name,
      description: skill.description || '',
      value: `skill://${skill.name}`,
    }));
}
