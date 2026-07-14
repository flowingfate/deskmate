/**
 * getChatMessagesTool — L2: read several raw messages by index.
 *
 * Long fields (text/thinking/tool result/arguments) are truncated to keep the first 60% and
 * last 40% above each threshold; image urls are replaced by [image: name W×H sizeKB] placeholders.
 * Up to 10 messages per call.
 */

import type { Tool } from '@earendil-works/pi-ai';
import { jsonSchema } from '@main/pi';
import type { DoctorSessionFile } from '../chatSession/types';
import { Profiles } from '../../../persist';
import {
  readMessages,
  MAX_MESSAGES_PER_CALL,
  TEXT_LIMIT,
  TOOL_RESULT_LIMIT,
  ARGUMENTS_LIMIT,
} from '../chatSession/messageReader';
import type { HistoryView } from '../chatSession/types';

export const getChatMessagesToolDef: Tool = {
  name: 'get_chat_messages',
  description: `Read up to ${MAX_MESSAGES_PER_CALL} chat messages by their indices in the skeleton returned by read_chat_session. Long fields are truncated: text/thinking ${TEXT_LIMIT} chars, tool result ${TOOL_RESULT_LIMIT} chars, tool_call arguments ${ARGUMENTS_LIMIT} chars; image url is replaced by a [image: name W×H sizeKB] placeholder. view='ui' reads messages directly; view='llm' derives the LLM context from messages + contextState (may report 'dropped' if a message was compressed away).`,
  parameters: jsonSchema({
    type: 'object',
    properties: {
      agentId: {
        type: 'string',
        description: 'The chat (agent) id the session belongs to.',
      },
      chatSessionId: {
        type: 'string',
        description: 'The chat session id to read.',
      },
      messageIndices: {
        type: 'array',
        items: { type: 'integer', minimum: 0 },
        description: `Message indices (0-based) from the skeleton. Max ${MAX_MESSAGES_PER_CALL} per call.`,
      },
      view: {
        type: 'string',
        enum: ['ui', 'llm'],
        description: "Which view to read. 'ui' = messages as displayed (default), 'llm' = messages as sent to LLM (may report 'dropped' for compressed messages).",
      },
    },
    required: ['agentId', 'chatSessionId', 'messageIndices'],
  }),
};

export async function executeGetChatMessages(args: {
  agentId: string;
  chatSessionId: string;
  messageIndices: number[];
  view?: HistoryView;
}): Promise<string> {
  const { agentId, chatSessionId, messageIndices } = args;

  if (!agentId || !chatSessionId) {
    return JSON.stringify({ error: 'agentId and chatSessionId are required.' });
  }
  if (!Array.isArray(messageIndices) || messageIndices.length === 0) {
    return JSON.stringify({ error: 'messageIndices must be a non-empty array.' });
  }
  for (const idx of messageIndices) {
    if (!Number.isInteger(idx) || (idx as number) < 0) {
      return JSON.stringify({
        error: `Invalid index ${JSON.stringify(idx)}; each must be a non-negative integer.`,
      });
    }
  }
  const indices = Array.from(new Set(messageIndices)).sort((a, b) => a - b);
  if (indices.length > MAX_MESSAGES_PER_CALL) {
    return JSON.stringify({
      error: `Too many indices (${indices.length} after dedupe); max ${MAX_MESSAGES_PER_CALL} per call.`,
    });
  }
  if (args.view !== undefined && args.view !== 'ui' && args.view !== 'llm') {
    return JSON.stringify({
      error: `Invalid view ${JSON.stringify(args.view)}; must be 'ui' or 'llm'.`,
    });
  }
  const view: HistoryView = args.view ?? 'ui';

  try {
    const file = await loadSessionFile(agentId, chatSessionId);
    if (!file) {
      return JSON.stringify({
        error: `Chat session "${chatSessionId}" not found under agent "${agentId}".`,
      });
    }

    const results = readMessages(file, { view, indices });
    return JSON.stringify({ view, results }, null, 2);
  } catch (err) {
    return JSON.stringify({
      error: `Error reading messages: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

async function loadSessionFile(agentId: string, chatSessionId: string): Promise<DoctorSessionFile | null> {
  const profile = await Profiles.get().active();
  const agent = await profile.getAgent(agentId);
  if (!agent) return null;
  const session = await agent.getSession(chatSessionId);
  if (!session) return null;
  const { messages } = await session.loadDomainMessages();
  return {
    chatSession_id: session.id,
    title: session.title,
    last_updated: session.config.updatedAt,
    messages,
    contextState: session.config.contextState,
  };
}
