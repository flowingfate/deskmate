/**
 * pi 路径下的一次性 LLM 调用入口（非 streaming）。
 *
 * 后台 utility（chat title / file name / doc summary / mcp config /
 * compression summary / system prompt writer / eval judge 等）共享同一
 * 调用模式：固定模型、不要工具、纯文本返回。
 *
 * 两个签名：
 *  - runUtilityCompletion：单轮 system + user prompt（最常用）
 *  - runUtilityChat：多轮 messages 数组（eval judge / 自由编排场景）
 *
 * 这里用 `pi.complete` 屏蔽 ghc 旧 API；apiKey 从 PiAuthManager 取。
 * 固定模型走 `${provider}::${modelId}` 复合 key，与 agent 模型 schema 对齐。
 */

import type { Api, Model, Message as PiMessage } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@shared/persist/types'

import { resolveModel, resolveCredentials } from './model';
import { parseAgentModel } from '@shared/utils/agentModelId';

/** 与 OpenAI chat completion 协议三角色对齐；utility 不带工具 */
export interface UtilityChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RunUtilityCompletionOptions {
  /** 形如 `github-copilot::claude-haiku-4.5` 的复合 key */
  modelKey: string;
  /** 当前 active profile id（src/main/persist 语义）。 */
  profileId: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * 可选 thinking level。utility 调用多数走低延迟小模型（haiku / mini），
   * 默认 undefined 让 provider 选最低档；个别需要重 reasoning 的场景
   *（如 doc summary）才显式传。
   */
  reasoning?: ThinkingLevel;
}

export interface RunUtilityChatOptions {
  modelKey: string;
  profileId: string;
  messages: UtilityChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** 见 RunUtilityCompletionOptions.reasoning */
  reasoning?: ThinkingLevel;
}

/**
 * 跑一次完整的 LLM 调用并返回拼接后的 text 内容（单轮模式）。
 *
 * pi.complete 返回 AssistantMessage（其 content 是块数组）—— 这里只保留
 * `type: 'text'` 块的拼接结果，丢弃 thinking / toolUse（utility 不使用）。
 *
 * 错误（auth / network / 模型错误）一律往上抛，由调用方决定重试 / 兜底。
 */
export async function runUtilityCompletion(opts: RunUtilityCompletionOptions): Promise<string> {
  return runUtilityChat({
    modelKey: opts.modelKey,
    profileId: opts.profileId,
    messages: buildMessages(opts.systemPrompt, opts.userPrompt),
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    reasoning: opts.reasoning,
  });
}

/**
 * 跑一次多轮 LLM 调用并返回拼接后的 text 内容。
 *
 * 适合调用方已经持有完整 OpenAI 风格 messages 数组的场景（如 eval judge：
 * 调用方自己拼 system + 多轮 user/assistant，pi 这边只负责执行）。
 *
 * messages 内的 system 角色会被合并/抽出为 pi.Context.systemPrompt
 * （pi 协议 systemPrompt 是独立字段，不是 message）。多个 system message
 * 拼成单条；其余 message 按顺序透传。
 */
export async function runUtilityChat(opts: RunUtilityChatOptions): Promise<string> {
  const parsed = parseAgentModel(opts.modelKey);
  if (!parsed) {
    throw new Error(`[pi/utility] Invalid modelKey: ${opts.modelKey}`);
  }
  const profileId = opts.profileId;
  if (!profileId) {
    throw new Error('[pi/utility] profileId is required');
  }
  if (opts.messages.length === 0) {
    throw new Error('[pi/utility] messages must not be empty');
  }

  const baseModel: Model<Api> = await resolveModel(parsed);
  const { apiKey, model } = await resolveCredentials(baseModel, profileId);

  const { systemPrompt, piMessages } = splitSystemAndChat(opts.messages);
  if (piMessages.length === 0) {
    throw new Error('[pi/utility] messages must include at least one user/assistant turn');
  }

  const pi = await import('@earendil-works/pi-ai');
  // completeSimple 而非 complete：与 session.streamSimple 保持一致 ——
  // utility 也可能用到带 reasoning 的 model（如 o3/o4 系列做 summary），
  // 通过 simple 入口让 pi-ai 处理 reasoning 字段。
  const result = await pi.completeSimple(
    model,
    { systemPrompt, messages: piMessages },
    {
      apiKey,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      reasoning: opts.reasoning,
    },
  );

  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

// ─── helpers ──────────────────────────────────────────────────────────────

function buildMessages(systemPrompt: string | undefined, userPrompt: string): UtilityChatMessage[] {
  const out: UtilityChatMessage[] = [];
  if (systemPrompt && systemPrompt.length > 0) {
    out.push({ role: 'system', content: systemPrompt });
  }
  out.push({ role: 'user', content: userPrompt });
  return out;
}

function splitSystemAndChat(
  messages: UtilityChatMessage[],
): { systemPrompt: string; piMessages: PiMessage[] } {
  const systemParts: string[] = [];
  const piMessages: PiMessage[] = [];
  const now = Date.now();

  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
    } else if (m.role === 'user') {
      piMessages.push({ role: 'user', content: m.content, timestamp: now });
    } else {
      // assistant — 无 thinking / tool 调用的纯文本回放
      piMessages.push({
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        api: 'openai-completions',
        provider: 'utility-replay',
        model: 'utility-replay',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now,
      });
    }
  }

  return { systemPrompt: systemParts.join('\n\n'), piMessages };
}
