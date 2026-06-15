/**
 * pi 路径下的 IPC contract —— 主进程 chat / auth / models 的唯一 IPC namespace。
 *
 * 关键点（auth 部分）：
 * - `startLogin` 立刻返回 sessionId；OAuth 流程的进度通过 mainToRender 事件推
 * - device-code / onAuth / onPrompt / onSelect 都走 mainToRender，UI 用 sessionId 路由
 * - onPrompt / onSelect 是问答式：main 等 renderer 的 submit；renderer 调
 *   `submitPrompt(sessionId, value)` 把答案塞回 main 进程的 Resolver map
 */

import { connectRenderToMain, connectMainToRender } from './base';
import type { ThinkingLevel } from '../types/thinkingLevel';
import type { ProviderAccountSummary } from '../types/piAuthTypes';

export interface SuccessResult<T = void> {
  success: true;
  data?: T;
}
export interface ErrorResult {
  success: false;
  error: string;
}
export type IpcResult<T = void> = SuccessResult<T> | ErrorResult;

// ──────────────────────────────────────────────
// model registry
// ──────────────────────────────────────────────

export interface PiModelListItem {
  id: string;
  name: string;
  /** UI 角标用 */
  reasoning?: boolean;
  toolCalls?: boolean;
  vision?: boolean;
}

/**
 * 给单个 model（按复合 key `${provider}::${modelId}` 查询）的完整能力描述。
 *
 * 取代老 `models.getModelById` / `getModelCapabilities` IPC —— pi 多 provider
 * 后渲染端无法再用"全量缓存"统一查询能力，改用按 modelKey 按需查询。
 */
export interface PiModelInfo {
  /** 复合 key 中的 modelId 部分 */
  id: string;
  /** UI 展示名 */
  name: string;
  /** input 上下文窗口（token） */
  contextWindow: number;
  /** 单次最大输出 token */
  maxTokens: number;
  /** 是否支持 tool_calls */
  supportsTools: boolean;
  /** 是否支持图片输入 */
  supportsImages: boolean;
  /** 是否是 reasoning model（有思考过程） */
  reasoning: boolean;
  /**
   * 该 model 支持的 thinking level 子集（pi-ai 标准枚举，已去掉 `'off'`）。
   *
   * 来源：`pi/model.ts::computeThinkingLevels` —— 读 pi-ai `thinkingLevelMap`，
   * 与 `getSupportedThinkingLevels(model)` 等价。非 reasoning model 返回空数组。
   *
   * UI 用此判断是否渲染 `ThinkingLevelSelector`：`length >= 2` 才有意义
   *（单一档=没得选；空数组=该模型根本不支持 reasoning）。
   */
  thinkingLevels: ThinkingLevel[];
}

// ──────────────────────────────────────────────
// Render → Main
// ──────────────────────────────────────────────

type RenderToMain = {
  // ── auth ──
  listAccounts: { call: []; return: IpcResult<ProviderAccountSummary[]> };
  startLogin: { call: [provider: string]; return: IpcResult<{ sessionId: string }> };
  cancelLogin: { call: [sessionId: string]; return: IpcResult };
  submitPrompt: { call: [sessionId: string, value: string | undefined]; return: IpcResult };
  setApiKey: { call: [provider: string, apiKey: string]; return: IpcResult };
  logout: { call: [provider: string]; return: IpcResult };

  // ── models ──
  /** 列出某 provider 当前可选的模型；走 `pi/model.ts::listModels`，统一来自 pi-ai 内置 model 表（含 github-copilot；ghcModelsManager 数据源已废弃）。IPC 请求路径零网络。 */
  listModelsForProvider: { call: [provider: string]; return: IpcResult<PiModelListItem[]> };
  /** 按复合 key 查询单个模型的能力描述；找不到返回 data:null（而非 error） */
  getModelInfo: { call: [modelKey: string]; return: IpcResult<PiModelInfo | null> };
};

// ──────────────────────────────────────────────
// Main → Render（auth 流式事件）
// ──────────────────────────────────────────────

export type MainToRender = {
  auth: { sessionId: string; url: string; instructions?: string };
  deviceCode: {
    sessionId: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds?: number;
    expiresInSeconds?: number;
  };
  prompt: { sessionId: string; message: string; placeholder?: string; allowEmpty?: boolean };
  select: { sessionId: string; message: string; options: Array<{ id: string; label: string }> };
  progress: { sessionId: string; message: string };
  loginComplete: { sessionId: string; success: boolean; provider: string; error?: string };
};

export const renderToMain = connectRenderToMain<RenderToMain>('pi');
export const mainToRender = connectMainToRender<MainToRender>('pi');
