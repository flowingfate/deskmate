/**
 * readChatSessionTool — L1: return a session skeleton (markdown).
 *
 * Returns no long content. Once the LLM has the structure, it calls get_chat_messages on demand
 * to read specific indices.
 */

import type { Tool } from '@earendil-works/pi-ai';
import { jsonSchema } from '@main/pi';
import type { ProfileStore } from '@main/persist';
import type { DoctorSessionFile } from '../chatSession/types';
import { formatSkeleton } from '../chatSession/skeletonFormatter';

export const readChatSessionToolDef: Tool = {
  name: 'read_chat_session',
  description: `Return a compact markdown skeleton of the chat session: header KV, plus tables for messages, with contextState summary. All fields are preserved; long content (text, thinking, image base64, tool_call arguments) is replaced by length numbers only. Use this first to understand shape and locate suspicious messages, then call get_chat_messages with specific indices to read them.`,
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
    },
    required: ['agentId', 'chatSessionId'],
  }),
};

export async function executeReadChatSession(
  store: ProfileStore,
  args: { agentId: string; chatSessionId: string },
): Promise<string> {
  const { agentId, chatSessionId } = args;

  if (!agentId || !chatSessionId) {
    return errorBlock('agentId and chatSessionId are required.');
  }

  try {
    const file = await loadSessionFile(store, agentId, chatSessionId);
    if (!file) {
      return errorBlock(`Chat session "${chatSessionId}" not found under agent "${agentId}".`);
    }
    return formatSkeleton(file);
  } catch (err) {
    return errorBlock(err instanceof Error ? err.message : String(err));
  }
}

async function loadSessionFile(store: ProfileStore, agentId: string, chatSessionId: string): Promise<DoctorSessionFile | null> {
  const agent = await store.getAgent(agentId);
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

function errorBlock(message: string): string {
  return `## Error\n\nread_chat_session failed: ${message}`;
}
