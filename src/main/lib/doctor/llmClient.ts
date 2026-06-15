/**
 * llmClient — Doctor Agent 的非流式 LLM 调用入口。
 *
 * 走 pi.complete（@earendil-works/pi-ai）；与老 ghc 直 fetch 路径相比：
 * - 多 provider：DOCTOR_MODEL 改为 `${provider}::${modelId}` 复合 key
 * - auth：从 pi/auth 的 PiAuthManager 取（与 chat 主链同源，token 自动 refresh）
 * - 截断：由 pi 通过 stopReason='length' 统一表达，本层不需要自己解析 SSE
 *
 * 对 agentRunner 的契约保持不变：`callDoctorLlm(messages, tools) → LlmResponse`
 * 内部消化 OpenAI 风格 messages/tools ↔ pi.Context 的翻译。
 */
import type {
  Api,
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  ImageContent as PiImageContent,
  Message as PiMessage,
  Model as PiModel,
  TextContent as PiTextContent,
  Tool as PiTool,
} from '@earendil-works/pi-ai';

import { Profiles } from '@main/persist';
import { resolveModel, resolveCredentials } from '@main/pi/model';
import { parseAgentModel } from '@shared/utils/agentModelId';
import { DOCTOR_MODEL_KEY } from './agentConfig';

/**
 * OpenAI function-calling shape — distinct from Domain `ToolCall`
 * (`@shared/types/message`). Doctor's LLM I/O stays bound to the OpenAI wire
 * format independent of Deskmate's internal Message canonical shape; keeping
 * a local type avoids leaking that wire shape back into the Domain layer.
 */
export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type MessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
>;

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: MessageContent }
  | { role: 'assistant'; content?: string; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface LlmResponse {
  content: string;
  toolCalls: OpenAiToolCall[];
  finishReason: string;
}

/** OpenAI function-calling tool def — TOOL_DEFINITIONS 中每一项的形态 */
interface OpenAiToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export async function callDoctorLlm(messages: ChatMessage[], tools: unknown[]): Promise<LlmResponse> {
  const profileId = Profiles.get().activeProfileId;
  if (!profileId) {
    throw new Error('Doctor agent requires an active profile.');
  }

  const parsed = parseAgentModel(DOCTOR_MODEL_KEY);
  if (!parsed) {
    throw new Error(`Invalid DOCTOR_MODEL_KEY: ${DOCTOR_MODEL_KEY}`);
  }

  const baseModel: PiModel<Api> = await resolveModel(parsed);
  const { apiKey, model } = await resolveCredentials(baseModel, profileId);

  const { systemPrompt, piMessages } = toPiMessages(messages);
  const piTools = await toPiTools(tools);

  const context: PiContext = {
    systemPrompt,
    messages: piMessages,
    tools: piTools,
  };

  const pi = await import('@earendil-works/pi-ai');
  const result = await pi.complete(model, context, {
    apiKey,
    temperature: 0.3,
  });

  return assistantToLlmResponse(result);
}

// ─── pi.AssistantMessage → LlmResponse ───────────────────────────────────────

function assistantToLlmResponse(msg: PiAssistantMessage): LlmResponse {
  let content = '';
  const toolCalls: OpenAiToolCall[] = [];

  for (const block of msg.content) {
    if (block.type === 'text') {
      content += block.text;
    } else if (block.type === 'toolCall') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.arguments ?? {}),
        },
      });
    }
    // thinking 块对 doctor 无意义，丢弃
  }

  return {
    content,
    toolCalls,
    finishReason: mapStopReason(msg.stopReason),
  };
}

/**
 * pi 的 stopReason 与 OpenAI 的 finish_reason 不是一一对应：pi 把
 * tool 调用归一为 'toolUse'，把截断归一为 'length'，error/aborted 单独。
 * agentRunner 只关心 'stop' / 'length' / 'tool_calls'，其余按 'stop' 处理。
 */
function mapStopReason(stop: PiAssistantMessage['stopReason']): string {
  switch (stop) {
    case 'toolUse':
      return 'tool_calls';
    case 'length':
      return 'length';
    case 'stop':
    default:
      return 'stop';
  }
}

// ─── ChatMessage[] → pi.Context ──────────────────────────────────────────────

interface ToPiResult {
  systemPrompt: string;
  piMessages: PiMessage[];
}

function toPiMessages(messages: ChatMessage[]): ToPiResult {
  const systemParts: string[] = [];
  const piMessages: PiMessage[] = [];
  const now = Date.now();

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else if (msg.role === 'user') {
      piMessages.push({
        role: 'user',
        content: userContentToPi(msg.content),
        timestamp: now,
      });
    } else if (msg.role === 'assistant') {
      piMessages.push(assistantChatMessageToPi(msg, now));
    } else if (msg.role === 'tool') {
      piMessages.push({
        role: 'toolResult',
        toolCallId: msg.tool_call_id,
        toolName: '',
        content: [{ type: 'text', text: msg.content }],
        isError: false,
        timestamp: now,
      });
    }
  }

  return { systemPrompt: systemParts.join('\n\n'), piMessages };
}

function userContentToPi(content: MessageContent): (PiTextContent | PiImageContent)[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  const out: (PiTextContent | PiImageContent)[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      out.push({ type: 'text', text: part.text });
    } else {
      out.push(imageUrlToPi(part.image_url.url));
    }
  }
  return out;
}

function assistantChatMessageToPi(
  msg: Extract<ChatMessage, { role: 'assistant' }>,
  timestamp: number,
): PiAssistantMessage {
  const content: PiAssistantMessage['content'] = [];
  if (msg.content && msg.content.length > 0) {
    content.push({ type: 'text', text: msg.content });
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      content.push({
        type: 'toolCall',
        id: tc.id,
        name: tc.function.name,
        arguments: parseToolArgs(tc.function.arguments),
      });
    }
  }
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'doctor-replay',
    model: 'doctor-replay',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  };
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function imageUrlToPi(url: string): PiImageContent {
  // data:image/png;base64,XXXX → mimeType/data 拆分；非 data URL 退化为 raw url
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (m) {
    return { type: 'image', data: m[2], mimeType: m[1] };
  }
  return { type: 'image', data: url, mimeType: 'image/png' };
}

// ─── OpenAI function tool def → pi.Tool ──────────────────────────────────────

async function toPiTools(tools: unknown[]): Promise<PiTool[]> {
  if (!tools || tools.length === 0) return [];
  const { Type } = await import('@earendil-works/pi-ai');
  const result: PiTool[] = [];
  for (const raw of tools) {
    const def = raw as OpenAiToolDef;
    if (def?.type !== 'function' || !def.function?.name) continue;
    result.push({
      name: def.function.name,
      description: def.function.description ?? '',
      parameters: Type.Unsafe(def.function.parameters ?? {}),
    });
  }
  return result;
}
