/**
 * llmClient — Doctor Agent 的非流式 LLM 调用入口。
 *
 * 走 pi.complete（@earendil-works/pi-ai）；相比老 ghc 直 fetch 路径：
 * - 多 provider：DOCTOR_MODEL 为 `${provider}::${modelId}` 复合 key
 * - auth：从 pi/auth 的 PiAuthManager 取（与 chat 主链同源，token 自动 refresh）
 * - 截断：由 pi 通过 stopReason='length' 统一表达，本层不需要自己解析 SSE
 *
 * 本层只做「解析 model/creds → 组 pi.Context → pi.complete」，直接吐回
 * 原始 `pi.AssistantMessage`。messages / tools 全程是 pi 原生形态，无翻译层：
 * agentRunner 直接说 pi 话（见其注释）。
 */
import type {
  Api,
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  Message as PiMessage,
  Model as PiModel,
  Tool as PiTool,
} from '@earendil-works/pi-ai';

import { resolveModel, resolveCredentials } from '@main/pi';
import { parseAgentModel } from '@shared/utils/agentModelId';

export async function callDoctorLlm(
  profileId: string,
  systemPrompt: string,
  messages: PiMessage[],
  tools: PiTool[],
  modelKey: string,
  signal: AbortSignal,
): Promise<PiAssistantMessage> {

  // 模型完全由用户在 renderer 选定；无内置默认。
  const parsed = parseAgentModel(modelKey);
  if (!parsed) {
    throw new Error(`Invalid doctor model key: ${modelKey}`);
  }

  const baseModel: PiModel<Api> = await resolveModel(parsed);
  const { apiKey, model } = await resolveCredentials(baseModel, profileId);

  const context: PiContext = {
    systemPrompt,
    messages,
    tools,
  };

  // pi-ai 是 ESM-only，主进程是 CJS bundle —— 全仓库统一动态 import 取其运行时值。
  const pi = await import('@earendil-works/pi-ai');
  return pi.complete(model, context, {
    apiKey,
    temperature: 0.3,
    signal,
  });
}
