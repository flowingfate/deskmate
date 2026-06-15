import { connectRenderToMain, connectMainToRender } from './base';
import type { Message, UserMessage } from '../types/message';
import type {
  ContextTokenUsage,
  ChatStatus,
} from '../types/agentChatTypes';
import type { StreamingChunk } from '../types/streamingTypes';
import type { TraceContext } from '../log/trace';
// ──────────────────────────────────────────
// Result types (discriminated unions)
// ──────────────────────────────────────────

type SuccessResult = { success: true };
type ErrorResult = { success: false; error?: string };
type IpcResult = SuccessResult | ErrorResult;

type SuccessDataResult<T> = { success: true; data: T };
type IpcDataResult<T> = SuccessDataResult<T> | ErrorResult;

type ForkChatSessionSuccess = { success: true; chatSessionId?: string };
type ForkChatSessionResult = ForkChatSessionSuccess | ErrorResult;

type ImportChatSessionSuccess = {
  success: true;
  importedSessions?: number;
  importedSessionId?: string;
  importedWorkspaceFiles?: number;
};
type ImportChatSessionResult = ImportChatSessionSuccess | ErrorResult;


export interface ChatSessionSnapshot {
  /** Domain canonical messages;renderer 自行 lift 到 RenderMessage 加 streamingComplete。 */
  messages: Message[];
  chatStatus: ChatStatus;
  title: string;
  contextTokenUsage?: ContextTokenUsage;
  /**
   * `SessionDataFile.turn?.status === 'running'` —— 上次进程退出时 turn 没收尾。
   * 主进程在 `consumePendingResume` 里把状态拉回 `aborted + idle`,但用户需要被
   * 提示并主动 retry。renderer 收到 `interrupted: true` 后由 UI 层把它翻译成
   * 文案 + 灌进 `ChatSessionCache.errorMessage`,触发现成 ErrorBar + Retry 按钮。
   * 文案不在主进程定 —— 多语 / 措辞调整不应跨越 IPC 边界。
   */
  interrupted?: boolean;
}

// ──────────────────────────────────────────
// R→M contract
// ──────────────────────────────────────────

type RenderToMain = {
  streamMessage: { call: [agentId: string, chatSessionId: string, message: UserMessage, trace?: TraceContext]; return: IpcDataResult<Message[]> };
  retryChat: { call: [agentId: string, chatSessionId: string, trace?: TraceContext]; return: IpcDataResult<Message[]> };
  editUserMessage: { call: [agentId: string, chatSessionId: string, messageId: string, updatedMessage: UserMessage, trace?: TraceContext]; return: IpcDataResult<Message[]> };
  canEditUserMessage: { call: [agentId: string, chatSessionId: string, messageId: string]; return: IpcDataResult<{ canEdit: boolean; error?: string }> };
  cancelChatSession: { call: [agentId: string, chatSessionId: string, trace?: TraceContext]; return: IpcResult };
  removeAgentInstance: { call: [agentId: string, chatSessionId: string]; return: IpcResult };
  forkChatSession: { call: [agentId: string, sourceChatSessionId: string]; return: ForkChatSessionResult };
  importChatSession: { call: [agentId: string]; return: ImportChatSessionResult };
  loadChatSessionSnapshot: { call: [agentId: string, chatSessionId: string]; return: IpcDataResult<ChatSessionSnapshot> };
  markSessionRead: { call: [agentId: string, chatSessionId: string]; return: IpcResult };
  loadJobRunSnapshot: { call: [agentId: string, jobId: string, runId: string]; return: IpcDataResult<ChatSessionSnapshot> };
  markJobRunRead: { call: [agentId: string, jobId: string, runId: string]; return: IpcResult };
};

// ──────────────────────────────────────────
// M→R contract
// ──────────────────────────────────────────

type MainToRender = {
  streamingChunk: StreamingChunk;
};

export const renderToMain = connectRenderToMain<RenderToMain>('agentChat');
export const mainToRender = connectMainToRender<MainToRender>('agentChat');
