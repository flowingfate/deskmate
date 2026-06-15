/**
 * Prompt history —— 简单的"用户输入历史 + 上下浏览"内存 store。
 *
 * 老 ProfileDataManager 把它和 profile data cache 揉在一起；本模块抽出独立
 * singleton，便于后者整体下线。无任何 IPC / 持久化，纯 in-memory，登出时由
 * `prompt-history.clear()` 清空。
 */

const MAX_HISTORY = 50;

let history: string[] = [];
let cursor = -1;            // -1 = 指向队尾（即 E 位置，准备追加新条目时回到此处）
let currentEditingPrompt = '';

export const promptHistory = {
  add(prompt: string): void {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    if (history[history.length - 1] === trimmed) {
      cursor = -1;
      return;
    }
    history.push(trimmed);
    if (history.length > MAX_HISTORY) history.shift();
    cursor = -1;
  },

  /** 返回上一条历史；到顶则返回最早一条。返回 null 表示 history 为空。 */
  previous(): string | null {
    if (history.length === 0) return null;
    if (cursor === -1) cursor = history.length - 1;
    else if (cursor > 0) cursor -= 1;
    return history[cursor];
  },

  /** 返回下一条历史；到底返回 currentEditingPrompt（用户当前输入），cursor 回到 -1。 */
  next(): string | null {
    if (history.length === 0) return null;
    if (cursor === -1) return null;
    if (cursor < history.length - 1) {
      cursor += 1;
      return history[cursor];
    }
    cursor = -1;
    return currentEditingPrompt;
  },

  setCurrentEditing(prompt: string): void {
    currentEditingPrompt = prompt;
  },

  getCurrentEditing(): string {
    return currentEditingPrompt;
  },

  isBrowsing(): boolean {
    return cursor !== -1;
  },

  stats(): { total: number; current: number; maxSize: number } {
    return { total: history.length, current: cursor, maxSize: MAX_HISTORY };
  },

  clear(): void {
    history = [];
    cursor = -1;
    currentEditingPrompt = '';
  },
};
