import { dispatchAppCommand, formatAppCmdContent } from './dispatcher';
import { parseCmdline } from './parseCmdline';
import type { AppCommand } from './types';
import type { ToolContext, ToolResult } from '../tools/types';

/** 执行一个顶层 command 的通用 cmdline 解析、调度与输出格式。 */
export async function executeCommandFacade(
  command: AppCommand,
  cmdline: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  const parsed = parseCmdline(cmdline);
  if (!parsed.ok) {
    return {
      ok: true,
      content: `${command.help}\ntip: cmdline parse error: ${parsed.error} — see USAGE above.\n`,
    };
  }

  const result = await dispatchAppCommand(command, parsed.argv, ctx);
  const content = formatAppCmdContent(result);
  return result.deliverables.length > 0
    ? { ok: true, content, deliverables: result.deliverables }
    : { ok: true, content };
}
