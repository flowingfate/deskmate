/**
 * L2 message reader: return raw JSON for several Messages by index, truncating long fields.
 *
 * - view='ui' indexes messages directly.
 * - view='llm' checks contextState to determine if a message was compressed away;
 *   returns a dropped signal when the message index falls within the compressed range.
 *
 * 形态:Domain Message (`@shared/types/message`)。Top-level 只有 user/assistant;
 * 工具结果折在 `assistant.tool_calls[i].response`,user 附件折在 `attachments[]`。
 */

import type { Message, ToolCall, Attachment } from '@shared/types/message';
import type { ContextState } from '@shared/types/agentChatTypes';
import { truncateMiddle } from './truncate';
import type { DoctorSessionFile, HistoryView } from './types';

/** 折叠 contextState.compressions 后用于 LLM 的消息序列。等价于老 lib/chat/buildLlmContext。
 *  `summary` 已是 Domain AssistantMessage,直接插入。 */
function buildLlmContext(messages: Message[], contextState: ContextState): Message[] {
  const top = contextState.compressions.length > 0
    ? contextState.compressions[contextState.compressions.length - 1]
    : null;
  if (top) {
    const { earlyPreservedCount, summary, compressedBeforeIndex } = top;
    return [
      ...messages.slice(0, earlyPreservedCount),
      summary,
      ...messages.slice(compressedBeforeIndex),
    ];
  }
  return [...messages];
}

export const MAX_MESSAGES_PER_CALL = 10;
export const TEXT_LIMIT = 5000;
export const TOOL_RESULT_LIMIT = 10000;
export const ARGUMENTS_LIMIT = 3000;

export interface ReadMessagesOptions {
  view: HistoryView;
  indices: number[];
}

export interface MessageReadResult {
  index: number;
  view: HistoryView;
  status: 'ok' | 'dropped' | 'out_of_range';
  message?: Message;
  note?: string;
}

export function readMessages(
  file: DoctorSessionFile,
  opts: ReadMessagesOptions,
): MessageReadResult[] {
  const { view, indices } = opts;
  const messages = file.messages ?? [];

  if (view === 'ui') {
    return indices.map((idx) => resolveUi(messages, idx));
  }

  const contextState = file.contextState ?? { compressions: [] };
  const llm = buildLlmContext(messages, contextState);
  const topCompression = contextState.compressions.length > 0
    ? contextState.compressions[contextState.compressions.length - 1]
    : null;

  return indices.map((idx) => {
    if (idx < 0 || idx >= messages.length) {
      return { index: idx, view: 'llm' as const, status: 'out_of_range' as const };
    }

    if (topCompression) {
      const ep = topCompression.earlyPreservedCount;
      const cbi = topCompression.compressedBeforeIndex;
      if (idx >= ep && idx < cbi) {
        return {
          index: idx,
          view: 'llm' as const,
          status: 'dropped' as const,
          note: 'message was compressed into summary (contextState.compressions)',
        };
      }
    }

    const msg = messages[idx];
    const llmMsg = llm.find((m) => m.id === msg.id);
    return {
      index: idx,
      view: 'llm' as const,
      status: 'ok' as const,
      message: redactMessage(llmMsg ?? msg),
      note: llmMsg !== msg ? 'message may include memory enhancement' : undefined,
    };
  });
}

function resolveUi(history: Message[], idx: number): MessageReadResult {
  if (idx < 0 || idx >= history.length) {
    return { index: idx, view: 'ui', status: 'out_of_range' };
  }
  return { index: idx, view: 'ui', status: 'ok', message: redactMessage(history[idx]) };
}

function redactMessage(msg: Message): Message {
  if (msg.role === 'assistant') {
    return {
      ...msg,
      content: truncateMiddle(msg.content ?? '', TEXT_LIMIT),
      think: truncateMiddle(msg.think ?? '', TEXT_LIMIT),
      tool_calls: (msg.tool_calls ?? []).map(redactToolCall),
    };
  }
  return {
    ...msg,
    content: truncateMiddle(msg.content ?? '', TEXT_LIMIT),
    attachments: (msg.attachments ?? []).map(redactAttachment),
  };
}

/**
 * 图片附件的 base64 数据替换为占位符;尺寸/名字等元信息保留。
 *
 * 选择:把 `[image: name WxH sizeKB]` 字符串 base64 编码后塞回 `source.data`,
 * 既保住 Domain 形状 (依旧是 dataUrl/data) 又自描述。`fileRef` 类来源不动 —— 它本身不带
 * 字节,引用大小由 `fileSize` 字段反映。
 *
 * 非 image 附件保留原样:它们是 fileUri 引用,本身无大字节负担。
 */
function redactAttachment(att: Attachment): Attachment {
  if (att.kind !== 'image') return att;
  if (att.source.kind !== 'dataUrl') return att;
  const sizeKB = att.fileSize ? `${Math.round(att.fileSize / 1024)}KB` : '?KB';
  const dims = att.width && att.height ? `${att.width}x${att.height}` : '?x?';
  const placeholder = `[image: ${att.fileName ?? 'unnamed'} ${dims} ${sizeKB}]`;
  return {
    ...att,
    source: { kind: 'dataUrl', data: Buffer.from(placeholder, 'utf8').toString('base64') },
  };
}

/**
 * Domain ToolCall = { id, name, time, args, response? }。
 *
 * 截断策略:`args` 序列化成 JSON 后按 `ARGUMENTS_LIMIT` 截中段,然后塞回
 * `{ __truncated__: <string> }`。这样既保住 `args: Record<string, unknown>` 类型契约,
 * 又让阅读者一眼看出 "原值已被截断,这是 doctor 视图,不是真值"。`response.result` 同理截断。
 */
function redactToolCall(call: ToolCall): ToolCall {
  const argsJson = (() => {
    try {
      return JSON.stringify(call.args ?? {});
    } catch {
      return '';
    }
  })();
  const truncatedArgs = truncateMiddle(argsJson, ARGUMENTS_LIMIT);
  const args: Record<string, unknown> =
    truncatedArgs.length === argsJson.length
      ? (call.args ?? {})
      : { __truncated__: truncatedArgs };

  // 只有真有 response 时才把字段挂回去 —— 避免在「无 response」的 ToolCall 上
  // 输出 `response: undefined`。JSON.stringify 会自动剔,但保留 in-memory 形态
  // 与 Domain 契约对齐(「字段缺席」≡「response 不存在」)。
  if (!call.response) {
    return { ...call, args };
  }
  return {
    ...call,
    args,
    response: { ...call.response, result: truncateMiddle(call.response.result ?? '', TOOL_RESULT_LIMIT) },
  };
}
