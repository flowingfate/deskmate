// src/renderer/lib/chat/agentIpc.ts
// AgentChat IPC wrapper - calls main process via IPC

import type { Message, UserMessage } from '@shared/types/message';
import type { ChatSessionSnapshot } from '@shared/ipc/agentChat';
import type { TraceContext } from '@shared/log/trace';
import { agentChatApi } from '@/ipc/agentChat';
class AgentIpc {
  async streamMessage(
    agentId: string,
    chatSessionId: string,
    message: UserMessage,
    trace?: TraceContext,
  ): Promise<Message[]> {
    const result = await agentChatApi.streamMessage(agentId, chatSessionId, message, trace);
    if (!result.success) {
      throw new Error(result.error || 'Failed to process conversation');
    }
    return result.data || [];
  }

  async editUserMessage(
    agentId: string,
    chatSessionId: string,
    messageId: string,
    updatedMessage: UserMessage,
    trace?: TraceContext,
  ): Promise<Message[]> {
    const result = await agentChatApi.editUserMessage(
      agentId,
      chatSessionId,
      messageId,
      updatedMessage,
      trace,
    );
    if (!result.success) {
      throw new Error(result.error || 'Failed to edit user message');
    }
    return result.data || [];
  }

  async canEditUserMessage(
    agentId: string,
    chatSessionId: string,
    messageId: string,
  ): Promise<{ canEdit: boolean; error?: string }> {
    const result = await agentChatApi.canEditUserMessage(
      agentId,
      chatSessionId,
      messageId,
    );
    if (!result.success) {
      throw new Error(result.error || 'Failed to validate user message editability');
    }
    return result.data || { canEdit: false, error: 'Failed to validate user message editability' };
  }

  async cancelChatSession(agentId: string, chatSessionId: string, trace?: TraceContext): Promise<void> {
    const result = await agentChatApi.cancelChatSession(agentId, chatSessionId, trace);
    if (!result.success) {
      throw new Error(result.error || 'Failed to cancel chat session');
    }
  }

  async loadChatSessionSnapshot(agentId: string, chatSessionId: string): Promise<ChatSessionSnapshot | null> {
    const result = await agentChatApi.loadChatSessionSnapshot(agentId, chatSessionId);
    if (!result.success) return null;
    return result.data;
  }

  async markSessionRead(agentId: string, chatSessionId: string): Promise<void> {
    await agentChatApi.markSessionRead(agentId, chatSessionId);
  }

  async loadJobRunSnapshot(agentId: string, jobId: string, runId: string): Promise<ChatSessionSnapshot | null> {
    const result = await agentChatApi.loadJobRunSnapshot(agentId, jobId, runId);
    if (!result.success) return null;
    return result.data;
  }

  async markJobRunRead(agentId: string, jobId: string, runId: string): Promise<void> {
    await agentChatApi.markJobRunRead(agentId, jobId, runId);
  }
}

export const agentIpc = new AgentIpc();
