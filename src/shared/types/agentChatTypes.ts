import type { AssistantMessage } from './message';
import type { PersistedJsonLine } from '../persist/types';
import type { AgentMcpServer } from './profileTypes';
// ===== Types migrated from main/lib/chat/agentChatTypes.ts =====

export interface ContextStats {
  totalMessages: number;
  contextMessages: number;
  tokenCount: number;
  compressionRatio: number;
}

export interface ContextTokenUsage {
  tokenCount: number;
  totalMessages: number;
  contextMessages: number;
  compressionRatio: number;
}

export enum ChatStatus {
  IDLE = 'idle',
  SENDING_RESPONSE = 'sending_response',
  COMPRESSING_CONTEXT = 'compressing_context',
  COMPRESSED_CONTEXT = 'compressed_context',
  RECEIVED_RESPONSE = 'received_response',
}

// ===== Types for IPC contract =====

export interface AgentInfo {
  role: string;
  emoji: string;
  name: string;
  model: string;
  mcpServers: AgentMcpServer[];
  systemPrompt: string;
  currentModel: string;
  toolsCount: number;
  chatHistoryLength: number;
}

export interface CompressionSnapshot {
  earlyPreservedCount: number;
  summary: AssistantMessage;
  compressedBeforeIndex: number;
  appliedAt: string;
}

export interface ContextState {
  compressions: CompressionSnapshot[];
  lastTokenUsage?: ContextTokenUsage;
}

/**
 * 下载 / 导入用的 chat session JSON 形态。messages 走 `PersistedJsonLine[]`(jsonl 行
 * 序列),与 `~/.deskmate/profiles/.../sessions/.../messages.jsonl` 严格对齐。
 * 导出 = 把 `loadMessagesAll()` 直接写到 JSON;导入 = 把 messages 数组当一段
 * jsonl 重新喂给 `Session.rewriteMessages`。
 */
export interface ChatSessionFile {
  chatSession_id: string;
  last_updated: string;
  title: string;
  messages: PersistedJsonLine[];
  contextState: ContextState;
}

export interface ChatStatusInfo {
  agentId: string;
  chatStatus: ChatStatus;
  agentName: string;
}

