import type { AgentMcpServer } from '../persist/types';
// ===== Types migrated from main/lib/chat/agentChatTypes.ts =====

export interface ContextStats {
  totalMessages: number;
  contextMessages: number;
  tokenCount: number;
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


export interface ChatStatusInfo {
  agentId: string;
  chatStatus: ChatStatus;
  agentName: string;
}

