import { connectRenderToMain, connectMainToRender } from './base';
import type { McpAuthClientIdRequestPayload, McpAuthClientIdResponse } from '../types/mcpAuth';
import type { McpServerConfig } from '../types/profileTypes';

export type { McpAuthClientIdRequestPayload, McpAuthClientIdResponse };

// ──────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────

export interface McpServerRuntimeState {
  serverName: string;
  status: string;
  tools: unknown[];
  lastError: string | null;
}

export interface McpAuthConsentPayload {
  requestId: string;
  serverName: string;
  providerLabel: string;
}


// ──────────────────────────────────────────────
// mcp — server status, tool execution, OAuth reset
// ──────────────────────────────────────────────

type McpRenderToMain = {
  getServerStatus: { call: []; return: { success: boolean; data?: McpServerRuntimeState[]; error?: string } };
  resetOAuth: { call: [serverName: string, scope?: 'tokens' | 'all']; return: { success: boolean; error?: string } };

  // Server CRUD（Step 7 PR-3 从老 profile 通道搬入；纯包装 mcpClientManager.*）
  addServer:        { call: [serverName: string, serverConfig: McpServerConfig]; return: { success: boolean; error?: string } };
  updateServer:     { call: [serverName: string, serverConfig: McpServerConfig]; return: { success: boolean; error?: string } };
  deleteServer:     { call: [serverName: string]; return: { success: boolean; error?: string } };
  connectServer:    { call: [serverName: string]; return: { success: boolean; error?: string } };
  reconnectServer:  { call: [serverName: string]; return: { success: boolean; error?: string } };
  disconnectServer: { call: [serverName: string]; return: { success: boolean; error?: string } };
};

type McpMainToRender = {
  serverStatesUpdated: McpServerRuntimeState[];
};

export const mcpRenderToMain = connectRenderToMain<McpRenderToMain>('mcp');
export const mcpMainToRender = connectMainToRender<McpMainToRender>('mcp');


// ──────────────────────────────────────────────
// mcpAuth — OAuth consent & client-id dialogs
// ──────────────────────────────────────────────

type McpAuthRenderToMain = {
  respondConsent: { call: [requestId: string, decision: 'cancel' | 'allow-this-time']; return: { success: boolean; error?: string } };
  respondClientId: { call: [requestId: string, response: McpAuthClientIdResponse]; return: { success: boolean; error?: string } };
};

type McpAuthMainToRender = {
  showConsent: McpAuthConsentPayload;
  requestClientId: McpAuthClientIdRequestPayload;
};

export const mcpAuthRenderToMain = connectRenderToMain<McpAuthRenderToMain>('mcpAuth');
export const mcpAuthMainToRender = connectMainToRender<McpAuthMainToRender>('mcpAuth');
