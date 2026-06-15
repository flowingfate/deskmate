/**
 * 把系统自动注入的内容包在 <system-reminder> 标签里。
 * Claude Code 约定：模型把标签内容当作 authoritative system 指令对待。
 * 从 lib/chat/systemReminderUtils.ts 搬过来（Step 4 PR5a 自包含化）。
 */
export function wrapInSystemReminder(content: string): string {
  if (!content) return content;
  return `<system-reminder>\n${content}\n</system-reminder>`;
}
