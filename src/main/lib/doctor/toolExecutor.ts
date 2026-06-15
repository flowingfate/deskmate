/**
 * Doctor Agent tool execution dispatcher.
 * A simple name→handler map; does not go through mcpClientManager.
 */

import { executeGetAppInfo } from './tools/getAppInfo';
import { executeGetAppKnowledge } from './tools/getAppKnowledge';
import { executeReadAppLogs } from './tools/readAppLogs';
import { executeGetLogSchema } from './tools/getLogSchema';
import { executeTraceTimeline } from './tools/traceTimeline';
import { executeReadChatSession } from './tools/readChatSession';
import { executeGetChatMessages } from './tools/getChatMessages';
import { executeGetCrashStatus } from './tools/getCrashStatus';
import { executeReadCrashBundle } from './tools/readCrashBundle';
import { executeReadSchedules } from './tools/readSchedules';
import { executeCreateGithubIssue } from './tools/createGithubIssue';
import { executeAskUserQuestion } from './tools/askUserQuestion';
import { log } from '@main/log';

const logger = log;

export interface ToolContext {
  taskId: string;
}

const handlers: Record<string, (args: any, context: ToolContext) => Promise<string>> = {
  get_app_info: (args) => executeGetAppInfo(),
  get_app_knowledge: (args) => executeGetAppKnowledge(),
  read_app_logs: (args) => executeReadAppLogs(args),
  get_log_schema: () => executeGetLogSchema(),
  trace_timeline: (args) => executeTraceTimeline(args),
  read_chat_session: (args) => executeReadChatSession(args),
  get_chat_messages: (args) => executeGetChatMessages(args),
  get_crash_status: (args) => executeGetCrashStatus(),
  read_crash_bundle: (args) => executeReadCrashBundle(args),
  read_schedules: (args) => executeReadSchedules(args),
  create_github_issue: (args) => executeCreateGithubIssue(args),
  ask_user_question: (args, context) => executeAskUserQuestion(args, context),
};

export async function executeTool(name: string, args: any, context: ToolContext): Promise<string> {
  const handler = handlers[name];
  if (!handler) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  logger.info({ msg: `[DoctorAgent] Executing tool: ${name}`, mod: 'executeTool', toolName: name, argsKeys: Object.keys(args || {}) });

  try {
    const result = await handler(args, context);
    logger.info({ msg: `[DoctorAgent] Tool completed: ${name}`, mod: 'executeTool', toolName: name, resultLength: result.length });
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ msg: `[DoctorAgent] Tool failed: ${name}`, mod: 'executeTool', toolName: name, err: errorMsg });
    return JSON.stringify({ error: errorMsg });
  }
}
