/**
 * Domain Message ↔ pi.Context 翻译。本文件是两个方向的**唯一**入口:
 *   - 入境: `fromPiAssistantMessage(pi.AssistantMessage) → Domain.AssistantMessage`
 *           pi 把 streaming 拼好的 final 还回来 → 聚合 thinking/text 双串、提 tool_calls、
 *           结构化 outcome (stopReason 翻 AssistantOutcome)
 *   - 出境: `toPiContext(Domain.Message[], systemPrompt, tools) → pi.Context`
 *           **1→N 展开**: 每条 Domain.AssistantMessage 之后,按其 tool_calls 顺序
 *           为已 response 的 ToolCall 紧跟一条 pi.toolResult message;无 response 的
 *           ToolCall 不输出 (这是 resume 的核心约束 —— 所有 ToolCall 必须先补跑出
 *           response 才能再调 LLM,见 `planResume.runMissingTools`)
 *
 * 没有 SystemMessage 翻译入口 —— system prompt 由 `buildSystemPrompt` 现拼,
 * 不进 messages 序列。
 */

import type {
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  ImageContent as PiImageContent,
  Message as PiMessage,
  TextContent as PiTextContent,
  ThinkingContent as PiThinkingContent,
  Tool as PiTool,
  ToolCall as PiToolCall,
  ToolResultMessage as PiToolResultMessage,
  UserMessage as PiUserMessage,
} from '@earendil-works/pi-ai';

import type {
  AssistantMessage,
  AssistantOutcome,
  Attachment,
  ErrorCategory,
  Message,
  ToolCall,
  UserMessage,
} from '@shared/types/message';

import { newMessageId } from '@shared/utils/messageFactory';
import { buildFileAnnotationText } from './fileAnnotation';

// ═══════════════════════════════════════════════════════════════════════════
// 出境: Domain → pi.Context
// ═══════════════════════════════════════════════════════════════════════════

export function toPiContext(
  messages: readonly Message[],
  systemPrompt: string,
  tools: PiTool[],
): PiContext {
  const piMessages: PiMessage[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      piMessages.push(userToPi(m));
      continue;
    }
    piMessages.push(assistantToPi(m));
    // 1→N 展开: 紧跟其有 response 的 ToolCall
    for (const tc of m.tool_calls) {
      if (!tc.response) continue;
      const content: (PiTextContent | PiImageContent)[] = [
        { type: 'text', text: tc.response.result },
      ];
      // 工具回传的图片(如 read 一个图片附件)→ ImageContent,模型据此"看到"图。
      for (const img of tc.response.images) {
        content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      }
      piMessages.push({
        role: 'toolResult',
        toolCallId: tc.id,
        toolName: tc.name,
        content,
        isError: tc.response.status === 'fail',
        timestamp: tc.response.time,
      } satisfies PiToolResultMessage);
    }
  }

  const trimmedSystem = systemPrompt.trim();
  const ctx: PiContext = { messages: piMessages };
  if (trimmedSystem) ctx.systemPrompt = trimmedSystem;
  if (tools.length > 0) ctx.tools = tools;
  return ctx;
}

function userToPi(msg: UserMessage): PiUserMessage {
  const content: (PiTextContent | PiImageContent)[] = [];
  // text + file/office/opaque annotation 合并成一段
  const annotation = buildFileAnnotationText(msg.attachments);
  const mergedText = [msg.content, annotation].filter((s) => s.length > 0).join('\n\n');
  if (mergedText) content.push({ type: 'text', text: mergedText });

  for (const att of msg.attachments) {
    // 只内联 image+dataUrl(小图)。image+fileRef(大图)已由 buildFileAnnotationText
    // 注入为可读文件,模型按需 read —— 不在此内联,避免把整张大图灌进上下文。
    if (att.kind !== 'image' || att.source.kind !== 'dataUrl') continue;
    content.push(attachmentImageToPi(att.mimeType, att.source.data));
  }

  return {
    role: 'user',
    content,
    timestamp: msg.time,
  };
}

function assistantToPi(msg: AssistantMessage): PiAssistantMessage {
  const content: (PiTextContent | PiThinkingContent | PiToolCall)[] = [];
  if (msg.think.length > 0) content.push({ type: 'thinking', thinking: msg.think });
  if (msg.content.length > 0) content.push({ type: 'text', text: msg.content });
  for (const tc of msg.tool_calls) content.push(toolCallToPi(tc));

  const outcome: AssistantOutcome = msg.outcome ?? { kind: 'stop' };
  const stopReason: PiAssistantMessage['stopReason'] =
    outcome.kind === 'aborted'
      ? 'aborted'
      : outcome.kind === 'error'
        ? 'error'
        // Domain 不映射 maxIter / length(turn-loop 自闭,不回灌给 LLM)。
        // 'toolUse' 由 Domain 的 tool_calls.length 自然表达,无需 outcome 标 enum。
        : msg.tool_calls.length > 0
          ? 'toolUse'
          : 'stop';

  return {
    role: 'assistant',
    content,
    api: '',
    provider: '',
    model: msg.model ?? '',
    usage: {
      input: msg.usage?.promptTokens ?? 0,
      output: msg.usage?.completionTokens ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: msg.usage?.totalTokens ?? 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: msg.time,
    ...(outcome.kind === 'error' ? { errorMessage: outcome.message } : {}),
  };
}

function attachmentImageToPi(mimeType: string, dataUrlBase64: string): PiImageContent {
  // 只内联 image+dataUrl(调用方 userToPi 已按 kind/source.kind 过滤)。
  // image+fileRef 大图不走这里 —— 它经 buildFileAnnotationText 注入,模型按需 read。
  return {
    type: 'image',
    data: dataUrlBase64,
    mimeType,
  };
}

function toolCallToPi(tc: ToolCall): PiToolCall {
  return {
    type: 'toolCall',
    id: tc.id,
    name: tc.name,
    arguments: tc.args,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 入境: pi.AssistantMessage → Domain.AssistantMessage
// ═══════════════════════════════════════════════════════════════════════════

export function fromPiAssistantMessage(msg: PiAssistantMessage): AssistantMessage {
  let think = '';
  let content = '';
  const tool_calls: ToolCall[] = [];

  for (const part of msg.content) {
    if (part.type === 'thinking') {
      think += part.thinking;
    } else if (part.type === 'text') {
      content += part.text;
    } else if (part.type === 'toolCall') {
      tool_calls.push({
        id: part.id,
        name: part.name,
        time: msg.timestamp,
        args: part.arguments ?? {},
      });
    }
  }

  const outcome = derivePiOutcome(msg, think, content, tool_calls.length);

  return {
    role: 'assistant',
    id: msg.responseId ?? newMessageId(),
    time: msg.timestamp,
    think,
    content,
    tool_calls,
    ...(outcome ? { outcome } : {}),
    ...(msg.model ? { model: msg.model } : {}),
    usage: {
      promptTokens: msg.usage.input,
      completionTokens: msg.usage.output,
      totalTokens: msg.usage.totalTokens,
    },
  };
}

function derivePiOutcome(
  msg: PiAssistantMessage,
  think: string,
  content: string,
  toolCallCount: number,
): AssistantOutcome | undefined {
  if (msg.stopReason === 'aborted') {
    const partial = think.length + content.length > 0 || toolCallCount > 0;
    return { kind: 'aborted', partial };
  }
  if (msg.stopReason === 'error') {
    const category = classifyPiError(msg.errorMessage);
    return {
      kind: 'error',
      message: msg.errorMessage ?? 'pi stream error',
      ...(category ? { category } : {}),
    };
  }
  // 'stop' / 'toolUse' 都视作 stop —— "是否再调一轮 LLM" 由 tool_calls + response 表达
  return undefined;
}

function classifyPiError(message?: string): ErrorCategory | undefined {
  if (!message) return undefined;
  const lower = message.toLowerCase();
  if (lower.includes('context') && lower.includes('length')) return 'overflow';
  if (lower.includes('overflow')) return 'overflow';
  if (lower.includes('rate') && lower.includes('limit')) return 'rateLimit';
  if (lower.includes('unauthorized') || lower.includes('auth')) return 'auth';
  if (lower.includes('network') || lower.includes('econnreset') || lower.includes('etimedout')) {
    return 'network';
  }
  return undefined;
}
