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
import { executeListCrashIncidents } from './tools/listCrashIncidents';
import { executeReadCrashIncident } from './tools/readCrashIncident';
import { executeReadSchedules } from './tools/readSchedules';
import { executeCreateGithubIssue } from './tools/createGithubIssue';
import { executeAskUserQuestion } from './tools/askUserQuestion';
import { log } from '@main/log';

import type { ProfileStore } from '@main/persist';
import type { DoctorTask } from './task';
const logger = log;

export interface ToolContext {
  task: DoctorTask;
  store: ProfileStore;
}

const handlers: Record<string, (args: any, context: ToolContext) => Promise<string>> = {
  get_app_info: () => executeGetAppInfo(),
  get_app_knowledge: () => executeGetAppKnowledge(),
  read_app_logs: (args) => executeReadAppLogs(args),
  get_log_schema: () => executeGetLogSchema(),
  trace_timeline: (args) => executeTraceTimeline(args),
  read_chat_session: (args, context) => executeReadChatSession(context.store, args),
  get_chat_messages: (args, context) => executeGetChatMessages(context.store, args),
  list_crash_incidents: (args) => executeListCrashIncidents(args),
  read_crash_incident: (args) => executeReadCrashIncident(args),
  read_schedules: (args, context) => executeReadSchedules(context.store, args),
  create_github_issue: (args, context) => executeCreateGithubIssue(args, context.task.id, context.task.signal),
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
