import type { ExtractedContent } from './extractedContent';

export type InteractiveRequestSource = 'assistant' | 'tool' | 'system';

// ── Approval ──

export interface ApprovalInteractionItem {
  itemId: string;
  toolCallId?: string;
  toolName: string;
  message: string;
  paths: Array<{
    path: string;
    normalizedPath?: string;
  }>;
}

export interface ApprovalInteractionRequest {
  chatSessionId: string;
  title: string;
  description?: string;
  items: ApprovalInteractionItem[];
}

export interface ApprovalInteractionResponse {
  action: 'approve' | 'reject' | 'submit';
  approvalItemDecisions: Array<{
    itemId: string;
    approved: boolean;
  }>;
}

// ── Choice ──

export interface ChoiceInteractionOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ChoiceInteractionRequest {
  chatSessionId: string;
  title: string;
  description?: string;
  mode: 'single' | 'multi';
  options: ChoiceInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
  submitLabel?: string;
  skipLabel?: string;
}

export interface ChoiceInteractionResponse {
  action: 'submit' | 'skip';
  selectedValues: string[];
}

// ── Form ──

export interface FormInteractionField {
  key: string;
  label: string;
  type: 'string' | 'int' | 'double' | 'boolean';
  control?: 'text' | 'textarea' | 'time' | 'folder' | 'file' | 'number' | 'checkbox' | 'select' | 'multiselect';
  varName?: string;
  required?: boolean;
  defaultValue?: string | number | boolean | string[];
  placeholder?: string;
  description?: string;
  options?: ChoiceInteractionOption[];
  minSelections?: number;
  maxSelections?: number;
}

export interface FormInteractionRequest {
  chatSessionId: string;
  title: string;
  description?: string;
  fields: FormInteractionField[];
  submitLabel?: string;
  skipLabel?: string;
}

export interface FormInteractionResponse {
  action: 'submit' | 'skip';
  formValues: Record<string, unknown>;
}

// ── Device Auth ──

export type DeviceAuthCommandFamily = 'gh-auth-login' | 'gh-auth-refresh' | 'az-login' | 'npm-login' | 'npm-adduser' | 'pnpm-login' | 'yarn-npm-login';

export function getDeviceAuthTitle(commandFamily: DeviceAuthCommandFamily): string {
  switch (commandFamily) {
    case 'gh-auth-login': return 'GitHub device login required';
    case 'gh-auth-refresh': return 'GitHub auth refresh required';
    case 'az-login': return 'Azure CLI sign-in required';
    case 'npm-login': return 'npm registry login required';
    case 'npm-adduser': return 'npm adduser confirmation required';
    case 'pnpm-login': return 'pnpm registry login required';
    case 'yarn-npm-login': return 'Yarn npm login required';
    default: return 'Browser authentication required';
  }
}

export interface DeviceAuthInteractionRequest {
  chatSessionId: string;
  title: string;
  commandFamily: DeviceAuthCommandFamily;
  command?: string;
  deviceCode?: string;
  verificationUri?: string;
  timeoutMs: number;
  startedAt: number;
}

export interface DeviceAuthInteractionResponse {
  action: 'cancel' | 'submit' | 'expire';
}

// ── Interactive Search ──

export type InteractiveSearchEngine = 'bing' | 'baidu';


export interface InteractiveSearchInteractionRequest {
  chatSessionId: string;
  callId: string;
  query: string;
  engine: InteractiveSearchEngine;
  searchUrl: string;
  maxSources: number;
  startedAt: number;
}

// research 来源 = 统一提取产物 + sourceId。**不落盘**，但是跨进程 IPC 契约。
export type InteractiveSearchSource = ExtractedContent & { sourceId: string };

export interface InteractiveSearchInteractionResponse {
  action: 'submit' | 'cancel';
  sources: InteractiveSearchSource[];
}


// ── Unions ──

export type InteractiveResponse =
  | ApprovalInteractionResponse
  | ChoiceInteractionResponse
  | FormInteractionResponse
  | DeviceAuthInteractionResponse
  | InteractiveSearchInteractionResponse;

// ── Pending request wrapper (used by renderer for storage + type discrimination) ──

export type PendingInteractiveRequest =
  | { type: 'approval'; id: string; request: ApprovalInteractionRequest }
  | { type: 'choice'; id: string; request: ChoiceInteractionRequest }
  | { type: 'form'; id: string; request: FormInteractionRequest }
  | { type: 'device-auth'; id: string; request: DeviceAuthInteractionRequest }
  | { type: 'interactive-search'; id: string; request: InteractiveSearchInteractionRequest };


interface Piar<In, Out> {
  in: In;
  out: Out;
}

export interface InteractiveMap {
  'approval': Piar<ApprovalInteractionRequest, ApprovalInteractionResponse>;
  'choice': Piar<ChoiceInteractionRequest, ChoiceInteractionResponse>;
  'form': Piar<FormInteractionRequest, FormInteractionResponse>;
  'device-auth': Piar<DeviceAuthInteractionRequest, DeviceAuthInteractionResponse>;
  'interactive-search': Piar<InteractiveSearchInteractionRequest, InteractiveSearchInteractionResponse>;
}

export type InteractiveRequestType = keyof InteractiveMap;