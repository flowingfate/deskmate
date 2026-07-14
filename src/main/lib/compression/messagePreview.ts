// src/main/lib/compression/messagePreview.ts
//
// 单条消息的预压缩 —— 在送入 summarize chunking 之前先把"明显过胖"的部分削短:
// - user.content / assistant.content 超 `maxTextMessageChars` → 头部截一段 + 标记
// - assistant.tool_calls[i].response.result 超 `maxToolTextChars` → 按 toolName
//   路由到结构化预览(`read` / `shell` / `*search*` / 通用 JSON / 纯文本)
//
// 保持 message 不可变:返回的对象与原对象不共享被改写的字段。
// 全部纯函数。无 I/O、无 LLM 调用。

import type { AssistantMessage, Message, ToolCall } from '@shared/persist/types'

/** 预压缩配置。FullModeCompressor 默认值在 `DEFAULT_PREVIEW_OPTIONS`。 */
export interface PreviewOptions {
  /** user / assistant 主文本超过此字符数则截短。 */
  maxTextMessageChars: number;
  /** 单个 tool result 超过此字符数则结构化压缩。 */
  maxToolTextChars: number;
}

export const DEFAULT_PREVIEW_OPTIONS: PreviewOptions = {
  maxTextMessageChars: 2400,
  maxToolTextChars: 1200,
};

export function prepareMessagesForCompression(
  messages: readonly Message[],
  opts: PreviewOptions = DEFAULT_PREVIEW_OPTIONS,
): Message[] {
  return messages.map((m) => prepareMessageForCompression(m, opts));
}

export function prepareMessageForCompression(
  message: Message,
  opts: PreviewOptions = DEFAULT_PREVIEW_OPTIONS,
): Message {
  if (message.role === 'user') {
    if (message.content.length > opts.maxTextMessageChars) {
      const compactText = buildCompressedPreview(message, message.content, opts.maxTextMessageChars);
      return { ...message, content: compactText };
    }
    return message;
  }

  // assistant: 同时压 content + 每个 tool_call.response.result
  let next: AssistantMessage = message;
  if (next.content.length > opts.maxTextMessageChars) {
    const compactText = buildCompressedPreview(next, next.content, opts.maxTextMessageChars);
    next = { ...next, content: compactText };
  }

  let toolCallsChanged = false;
  const newToolCalls: ToolCall[] = next.tool_calls.map((tc) => {
    if (!tc.response) return tc;
    if (tc.response.result.length <= opts.maxToolTextChars) return tc;
    toolCallsChanged = true;
    const compact = buildToolResultPreview(tc.name, tc.response.result, opts.maxToolTextChars);
    return { ...tc, response: { ...tc.response, result: compact } };
  });
  if (toolCallsChanged) {
    next = { ...next, tool_calls: newToolCalls };
  }
  return next;
}

// ─── 主文本(content / think) ──────────────────────────────────────────────

/**
 * user / assistant 主文本压缩预览。**不针对 tool 结果**,那条路径走
 * `buildToolResultPreview`(按 toolName 路由)。
 */
export function buildCompressedPreview(message: Message, text: string, maxChars: number): string {
  const preview = text.slice(0, Math.max(0, maxChars - 200));
  return `${preview}\n\n[Compressed for summary generation; originalLength=${text.length}; role=${message.role}]`;
}

// ─── Tool result —— 按 toolName 路由 ───────────────────────────────────────

/**
 * 按 toolName 路由的结构化 tool result 压缩。原 `buildCompressedPreview`
 * 中的 ToolMessage 分支拆出来 —— Domain 形态下 tool 结果不再是顶层 message,
 * 这里只接收"结果原文 + tool name",输出压缩文本。
 *
 * 路由优先级:
 *   1. `read`              → file/range/totalLines/size + content 预览
 *   2. `shell` / `run_in_terminal` → command/exitCode/stdout 预览
 *   3. /(search|grep|semantic|query)/i → resultCount + topResults
 *   4. JSON 对象           → keys 列表 + 截断的 JSON
 *   5. 纯文本              → 朴素截断 + 元信息标记
 */
export function buildToolResultPreview(toolName: string, rawText: string, maxChars: number): string {
  const parsedJson = tryParseJson(rawText);

  if (toolName === 'read') {
    return buildReadPreview(toolName, parsedJson, rawText, maxChars);
  }

  if (toolName === 'shell' || toolName === 'run_in_terminal') {
    return buildCommandPreview(toolName, parsedJson, rawText, maxChars);
  }

  if (/(search|grep|semantic|query)/i.test(toolName)) {
    return buildSearchPreview(toolName, parsedJson, rawText, maxChars);
  }

  if (parsedJson && typeof parsedJson === 'object') {
    return buildGenericJsonPreview(toolName, parsedJson, rawText, maxChars);
  }

  const preview = rawText.slice(0, Math.max(0, maxChars - 200));
  return `${preview}\n\n[Compressed for summary generation; originalLength=${rawText.length}; role=tool; name=${toolName}]`;
}

function buildReadPreview(toolName: string, parsedJson: unknown, rawText: string, maxChars: number): string {
  const payload = unwrapPrimaryPayload(parsedJson);
  // `read` 工具返回值字段:`fileName`(basename derived in backend)+ 可选 `url`(internal-url 资源)。
  // 业务路径优先 `url`(`skill://foo` 比裸文件名信息量大),否则 `fileName`。
  const filePath = extractString(payload, ['url', 'fileName']);
  const content = extractString(payload, ['content', 'text']) || rawText;
  const startLine = extractNumber(payload, 'startLine');
  const endLine = extractNumber(payload, 'endLine');
  const totalLines = extractNumber(payload, 'totalLines');
  const size = extractNumber(payload, 'size');
  const preview = content.slice(0, Math.max(0, maxChars - 360));
  return [
    '[Structured compression: read]',
    filePath ? `file=${filePath}` : null,
    startLine !== undefined ? `range=${startLine}-${endLine ?? startLine}` : null,
    totalLines !== undefined ? `totalLines=${totalLines}` : null,
    size !== undefined ? `size=${size}` : null,
    `contentPreview=${preview}`,
    `[Compressed for summary generation; originalLength=${rawText.length}; role=tool; name=${toolName || 'read'}]`,
  ].filter(Boolean).join('\n');
}

function buildCommandPreview(toolName: string, parsedJson: unknown, rawText: string, maxChars: number): string {
  const payload = unwrapPrimaryPayload(parsedJson);
  const command = extractString(payload, ['command', 'cmd', 'lastCommand']);
  const exitCode = extractNumber(payload, 'exitCode');
  const stdout = extractString(payload, ['stdout', 'output', 'result']) || rawText;
  const preview = stdout.slice(0, Math.max(0, maxChars - 300));
  return [
    `[Structured compression: ${toolName || 'command_output'}]`,
    command ? `command=${command}` : null,
    exitCode !== undefined ? `exitCode=${exitCode}` : null,
    `outputPreview=${preview}`,
    `[Compressed for summary generation; originalLength=${rawText.length}; role=tool; name=${toolName || 'unknown_tool'}]`,
  ].filter(Boolean).join('\n');
}

function buildSearchPreview(toolName: string, parsedJson: unknown, rawText: string, maxChars: number): string {
  const payload = unwrapPrimaryPayload(parsedJson);
  const results = extractArray(payload, ['results', 'items', 'matches', 'data']);
  const previewItems = results.slice(0, 3).map((item: unknown, index: number) => {
    if (typeof item === 'string') {
      return `${index + 1}. ${item}`;
    }
    const title = extractString(item, ['title', 'name', 'path', 'url']) || `item_${index + 1}`;
    const snippet = extractString(item, ['snippet', 'text', 'description', 'lineContent']);
    return snippet ? `${index + 1}. ${title} :: ${snippet}` : `${index + 1}. ${title}`;
  });
  const fallbackPreview = rawText.slice(0, Math.max(0, maxChars - 260));
  return [
    `[Structured compression: ${toolName}]`,
    results.length > 0 ? `resultCount=${results.length}` : null,
    previewItems.length > 0 ? `topResults=${previewItems.join(' | ')}` : `preview=${fallbackPreview}`,
    `[Compressed for summary generation; originalLength=${rawText.length}; role=tool; name=${toolName}]`,
  ].filter(Boolean).join('\n');
}

function buildGenericJsonPreview(toolName: string, parsedJson: unknown, rawText: string, maxChars: number): string {
  const payload = unwrapPrimaryPayload(parsedJson);
  const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>).slice(0, 12)
    : [];
  const preview = JSON.stringify(payload).slice(0, Math.max(0, maxChars - 240));
  return [
    '[Structured compression: json_payload]',
    keys.length > 0 ? `keys=${keys.join(',')}` : null,
    `preview=${preview}`,
    `[Compressed for summary generation; originalLength=${rawText.length}; role=tool${toolName ? `; name=${toolName}` : ''}]`,
  ].filter(Boolean).join('\n');
}

// ─── JSON 提取小工具(typed unknown 读取) ──────────────────────────────────

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** payload 顶层是数组时取 [0],否则原值;空值给空对象避免后续判空。 */
function unwrapPrimaryPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0] ?? {};
  }
  return value ?? {};
}

function extractString(value: unknown, keys: readonly string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = obj[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function extractNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
}

function extractArray(value: unknown, keys: readonly string[]): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = obj[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
