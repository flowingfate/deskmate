import { connectRenderToMain, connectMainToRender } from './base';
import type { ChatSession, ChatSessionFile } from '../persist/types';
import type { AgentUnreadSummary } from '../types/chatSessionTypes';

type IpcResult<T> =
  | { success: true } & T
  | { success: false; error: string };

type RenderToMain = {
  downloadChatSession: {
    call: [agentId: string, sessionId: string, title: string];
    return: IpcResult<{ filePath: string; fileName: string }>;
  };
  getFilePath: {
    call: [agentId: string, sessionId: string];
    return: IpcResult<{ filePath: string }>;
  };
};

export interface SessionCreatedPayload {
  agentId: string;
  session: ChatSession;
  timestamp: number;
}

export interface MetadataPatchedPayload {
  agentId: string;
  chatSessionId: string;
  metadata: ChatSession;
  timestamp: number;
}

export interface FilePatchedPayload {
  agentId: string;
  chatSessionId: string;
  file: ChatSessionFile;
  timestamp: number;
}

export interface SessionDeletedPayload {
  agentId: string;
  chatSessionId: string;
  timestamp: number;
}

export interface UnreadSummaryChangedPayload {
  summary: AgentUnreadSummary;
  timestamp: number;
}

type MainToRender = {
  sessionCreated: SessionCreatedPayload;
  metadataPatched: MetadataPatchedPayload;
  filePatched: FilePatchedPayload;
  sessionDeleted: SessionDeletedPayload;
  unreadSummaryChanged: UnreadSummaryChangedPayload;
};

export const renderToMain = connectRenderToMain<RenderToMain>('chatSession');
export const mainToRender = connectMainToRender<MainToRender>('chatSessionStore');
